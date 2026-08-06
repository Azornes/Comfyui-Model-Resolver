import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import {
  html,
  normalizePathIdentity,
  safeStorage,
} from '../web/resolver/utils/html_utils.js';
import { getModelCardUrl } from '../web/resolver/utils/url_utils.js';
import {
  classifyLocalMatches,
  matchesLocalModelDownload,
} from '../web/resolver/utils/local_match_utils.js';
import { extractComfyWorkflow } from '../web/resolver/utils/workflow_metadata.js';
import {
  buildModelResolverNodeMenu,
  getImmediateModelsForNode,
  getResolvedModelsForNode,
  isExistingResolvedModel,
  matchesWorkflowModelReference,
  toResolverContextModel,
} from '../web/resolver/node_context_menu.js';
import { startSplitterDrag } from '../web/resolver/utils/splitter_drag.js';
import { normalizeDownloadCategoryValue } from '../web/resolver/utils/category_utils.js';
import {
  CATEGORY_ALIASES,
  normalizeCategoryToken,
} from '../web/resolver/utils/category_aliases.generated.js';
import { getSha256Field, normalizeSha256 } from '../web/resolver/utils/hash_utils.js';
import { getSourceDisplayLabel, normalizeSourceKey } from '../web/resolver/utils/source_labels.js';
import { baseModelAliasMethods } from '../web/resolver/search/base_model_alias_methods.js';
import { searchHashMethods } from '../web/resolver/search/search_hash_methods.js';
import { missingModelStateMethods } from '../web/resolver/views/missing_model_state_methods.js';
import { workflowIdentityMethods } from '../web/resolver/shell/workflow_identity_methods.js';
import {
  getCustomNodeModelAdapter,
  getCustomNodeModelCategory,
  getCustomNodeModelEntries,
  getCustomNodeModelListSignature as createCustomNodeModelListSignature,
  getCustomNodeModelStrengthSignature as createCustomNodeModelStrengthSignature,
  getCustomNodeOriginalIdentity,
  isCustomNodeModelWidget as matchesCustomNodeModelWidget,
} from '../web/resolver/custom_nodes/registry.js';

void normalizeDownloadCategoryValue;
void CATEGORY_ALIASES;
void normalizeCategoryToken;
void normalizeSha256;

const projectRoot = path.resolve(import.meta.dirname, '..');
const queueMethodsSource = fs.readFileSync(
  path.join(projectRoot, 'web/resolver/actions/queue_methods.js'),
  'utf8'
);
const modelResolverSource = fs.readFileSync(
  path.join(projectRoot, 'web/resolver/model_resolver.js'),
  'utf8'
);
const optionsMethodsSource = fs.readFileSync(
  path.join(projectRoot, 'web/resolver/views/options_methods.js'),
  'utf8'
);
const resolveDownloadMethodsSource = fs.readFileSync(
  path.join(projectRoot, 'web/resolver/actions/resolve_download_methods.js'),
  'utf8'
);
const downloadProgressMethodsSource = fs.readFileSync(
  path.join(projectRoot, 'web/resolver/actions/download_progress_methods.js'),
  'utf8'
);
const downloadTargetMethodsSource = fs.readFileSync(
  path.join(projectRoot, 'web/resolver/search/download_target_methods.js'),
  'utf8'
);
const searchPanelMethodsSource = fs.readFileSync(
  path.join(projectRoot, 'web/resolver/search/search_panel.js'),
  'utf8'
);
const modelInfoMethodsSource = fs.readFileSync(
  path.join(projectRoot, 'web/resolver/views/model_info_methods.js'),
  'utf8'
);
const missingBrowserMethodsSource = fs.readFileSync(
  path.join(projectRoot, 'web/resolver/views/missing_browser_methods.js'),
  'utf8'
);
const tabsLoadedMethodsSource = fs.readFileSync(
  path.join(projectRoot, 'web/resolver/views/tabs_loaded_methods.js'),
  'utf8'
);
const resolverDialogSource = fs.readFileSync(
  path.join(projectRoot, 'web/resolver/resolver_dialog.js'),
  'utf8'
);
const workflowStateMethodsSource = fs.readFileSync(
  path.join(projectRoot, 'web/resolver/shell/workflow_state_methods.js'),
  'utf8'
);
const lifecycleGraphMethodsSource = fs.readFileSync(
  path.join(projectRoot, 'web/resolver/shell/lifecycle_graph_methods.js'),
  'utf8'
);
const workflowUpdateMethodsSource = fs.readFileSync(
  path.join(projectRoot, 'web/resolver/shell/workflow_update_methods.js'),
  'utf8'
);
const dialogShellMethodsSource = fs.readFileSync(
  path.join(projectRoot, 'web/resolver/shell/dialog_shell_methods.js'),
  'utf8'
);
const renderFormatMethodsSource = fs.readFileSync(
  path.join(projectRoot, 'web/resolver/utils/render_format_methods.js'),
  'utf8'
);
const resolverMainCssSource = fs.readFileSync(
  path.join(projectRoot, 'web/css/resolver-main.css'),
  'utf8'
);
const resolverShellCssSource = fs.readFileSync(
  path.join(projectRoot, 'web/css/resolver-shell.css'),
  'utf8'
);

test('Missing Models rows use fixed-size virtualization for smooth stable scrolling', () => {
  const rowRules = Array.from(
    resolverMainCssSource.matchAll(/#model-resolver-modal \.mr-missing-list-row\s*\{([^}]+)\}/g)
  );
  const rowRule = rowRules.find(match => /width\s*:\s*100%/.test(match[1]));

  assert.ok(rowRule, 'Expected the Missing Models row style');
  assert.match(rowRule[1], /content-visibility\s*:\s*auto/);
  assert.match(rowRule[1], /contain-intrinsic-size\s*:\s*var\(--mr-missing-row-height\)/);
  assert.match(rowRule[1], /height\s*:\s*var\(--mr-missing-row-height\)/);
  assert.match(rowRule[1], /min-height\s*:\s*var\(--mr-missing-row-height\)/);
  assert.match(rowRule[1], /box-sizing\s*:\s*border-box/);
  assert.match(rowRule[1], /contain\s*:\s*layout paint style/);
});

test('manual model selection uses the two-line status card layout', () => {
  const updateSelectedBarForMissing = extractMethod(
    queueMethodsSource,
    'updateSelectedBarForMissing'
  );

  assert.match(updateSelectedBarForMissing, /mr-selected-summary/);
  assert.match(updateSelectedBarForMissing, /mr-selected-status-icon/);
  assert.match(updateSelectedBarForMissing, /getSvgIcon\('circleCheckBig'\)/);
  assert.match(updateSelectedBarForMissing, /<span>Selected<\/span>/);
  assert.doesNotMatch(updateSelectedBarForMissing, /Selected:/);
  assert.match(updateSelectedBarForMissing, /mr-selected-apply/);
  assert.match(updateSelectedBarForMissing, /mr-selected-remove/);
  assert.match(
    updateSelectedBarForMissing,
    /selectedBar\.innerHTML\s*=\s*`[\s\S]*?<div class="mr-selected-bar-inner"[\s\S]*?<\/div>\s*`;/
  );
  assert.doesNotMatch(updateSelectedBarForMissing, /selectedBar\.innerHTML\s*\+=/);
  assert.match(resolverMainCssSource, /\.mr-selected-summary\s*\{[^}]*flex-direction:\s*column/s);
  assert.match(
    resolverMainCssSource,
    /\.mr-missing-list-row\.is-selected,\s*#model-resolver-modal \.mr-missing-detail-pane \.model-resolver-selected\s*\{[^}]*background:\s*linear-gradient[^}]*box-shadow:\s*inset 3px 0 0/s
  );
  assert.match(
    resolverMainCssSource,
    /\.mr-missing-detail-pane \.model-resolver-selected\s*\{[^}]*height:\s*var\(--mr-missing-row-height\)[^}]*border-radius:\s*0/s
  );
  assert.match(
    resolverMainCssSource,
    /\.mr-missing-detail-pane \.mr-selected-bar-inner\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto/s
  );
  assert.doesNotMatch(
    resolverMainCssSource,
    /\.mr-missing-detail-pane \.mr-selected-bar-inner\s*\{[^}]*flex-direction:\s*column/s
  );
  assert.match(
    resolverMainCssSource,
    /\.mr-missing-detail-pane \.model-resolver-selected \.mr-btn-danger:hover[^}]*background:\s*rgba\(239,\s*68,\s*68/s
  );
});

test('manual model selection restores the per-model apply card after browser refresh', () => {
  const queueResolution = eval(`(${extractMethod(queueMethodsSource, 'queueResolution')})`);
  const calls = [];
  const missing = { key: 'missing-a' };
  const dialog = {
    pendingIndex: new Map(),
    pendingResolutions: [],
    missingModels: [{ key: 'missing-a', refreshed: true }],
    getMissingModelKey(model) {
      return model.key;
    },
    buildResolutionSelection(model, resolvedModel) {
      return {
        missing_key: model.key,
        resolved_model: resolvedModel,
        resolved_path: resolvedModel.path,
      };
    },
    getResolutionQueueKey(selection) {
      return selection.missing_key;
    },
    savePendingQueueForActiveWorkflow() {},
    updateQueuePanel() {},
    updateApplyPendingButton() {},
    refreshMissingModelsBrowserFromCache() {
      calls.push('refresh');
    },
    updateSelectedBarForMissing(model) {
      calls.push(['selected', model]);
    },
  };

  queueResolution.call(dialog, missing, { path: 'models/vae/model.safetensors' });

  assert.deepEqual(calls, [
    'refresh',
    ['selected', { key: 'missing-a', refreshed: true }],
  ]);
});

test('floating dialog drag stays on the compositor without forced style reads', () => {
  const isVisible = extractMethod(dialogShellMethodsSource, 'isVisible');
  const saveModalPosition = extractMethod(dialogShellMethodsSource, 'saveModalPosition');
  const startDrag = extractMethod(dialogShellMethodsSource, 'startDrag');
  const onDrag = eval(`(${extractMethod(dialogShellMethodsSource, 'onDrag')})`);
  const endDrag = extractMethod(dialogShellMethodsSource, 'endDrag');
  const startDockedDrag = extractMethod(dialogShellMethodsSource, 'startDockedDrag');
  const onDockedDrag = extractMethod(dialogShellMethodsSource, 'onDockedDrag');
  const endDockedDrag = extractMethod(dialogShellMethodsSource, 'endDockedDrag');

  assert.doesNotMatch(isVisible, /getComputedStyle/);
  assert.match(isVisible, /style\.display\s*===\s*['"]flex['"]/);
  assert.match(saveModalPosition, /Number\(position\?\.top\)/);
  assert.match(saveModalPosition, /Number\.isFinite\(top\)\s*&&\s*Number\.isFinite\(left\)/);
  assert.match(startDrag, /preventDefault/);
  assert.match(startDrag, /if \(this\.docked\)\s*\{\s*this\.startDockedDrag\(e\)/);
  assert.match(startDrag, /style\.willChange\s*=\s*['"]transform['"]/);
  assert.match(startDrag, /setDockDropPreviewActive\(false\)/);
  assert.match(startDrag, /updateDockDropPreviewWidth\(\)/);
  assert.doesNotMatch(startDrag, /document\.body\.style\.userSelect/);
  assert.doesNotMatch(startDrag, /classList\.add\(['"]mr-is-window-dragging['"]\)/);
  assert.match(endDrag, /cancelAnimationFrame/);
  assert.match(endDrag, /style\.top/);
  assert.match(endDrag, /style\.left/);
  assert.match(endDrag, /style\.transform\s*=\s*['"]none['"]/);
  assert.match(endDrag, /saveModalPosition\(finalPosition\)/);
  assert.match(endDrag, /style\.willChange\s*=\s*['"]['"]/);
  assert.match(endDrag, /const shouldDock = this\._dragDockCandidate/);
  assert.match(endDrag, /if \(shouldDock\)\s*\{\s*this\.dockToSidebar\(\)/);
  assert.doesNotMatch(resolverShellCssSource, /mr-is-window-dragging/);
  assert.match(resolverDialogSource, /mr-dock-drop-preview/);
  assert.match(resolverDialogSource, /mr-undock-drop-preview/);
  assert.match(startDockedDrag, /getRememberedFloatingSize\(\)/);
  assert.match(onDockedDrag, /Math\.hypot\(dx,\s*dy\)\s*<\s*5/);
  assert.match(onDockedDrag, /e\.clientX\s*>\s*this\.getDockSnapThreshold\(\)/);
  assert.match(onDockedDrag, /setUndockDropPreviewActive\(shouldUndock\)/);
  assert.match(onDockedDrag, /requestAnimationFrame/);
  assert.match(endDockedDrag, /this\.undockToFloating\(\{\s*persist:\s*false\s*\}\)/);
  assert.match(endDockedDrag, /this\._floatingRectBeforeDock\s*=\s*\{\s*\.\.\.finalRect\s*\}/);
  assert.match(
    resolverShellCssSource,
    /\.mr-undock-drop-preview\s*\{[^}]*pointer-events:\s*none[^}]*visibility:\s*hidden[^}]*opacity:\s*0/s
  );
  assert.match(
    modelResolverSource,
    /renderSidebarPanel\(element\)[\s\S]*?rememberDockDropPreviewWidth\?\.\(element\)/
  );
  assert.match(
    resolverShellCssSource,
    /\.mr-dock-drop-preview\s*\{[^}]*pointer-events:\s*none[^}]*visibility:\s*hidden[^}]*opacity:\s*0/s
  );
  assert.match(
    resolverShellCssSource,
    /\.mr-dock-drop-preview\.is-active\s*\{[^}]*visibility:\s*visible[^}]*opacity:\s*1/s
  );

  const handlerStart = modelResolverSource.indexOf('const documentClickHandler = (event) => {');
  const handlerEnd = modelResolverSource.indexOf('const focusHandler =', handlerStart);
  const handlerSource = modelResolverSource.slice(handlerStart, handlerEnd);
  assert.ok(handlerStart >= 0 && handlerEnd > handlerStart);
  assert.ok(
    handlerSource.indexOf("target?.closest('#model-resolver-modal, .model-resolver-backdrop')") <
      handlerSource.indexOf('dialog?.isVisible()'),
    'clicks inside the resolver must return before checking dialog visibility'
  );

  const previousRequestAnimationFrame = globalThis.requestAnimationFrame;
  let frameCallback = null;
  globalThis.requestAnimationFrame = callback => {
    frameCallback = callback;
    return 17;
  };

  try {
    const element = { style: {} };
    const dockPreviewStates = [];
    const dialog = {
      element,
      _dragging: true,
      _dragStart: { x: 10, y: 20, top: 100, left: 200 },
      _dragBounds: { minLeft: 0, maxLeft: 500, minTop: 0, maxTop: 400 },
      _dragPendingPosition: null,
      _dragAnimationFrame: null,
      getDockSnapThreshold: () => 64,
      setDockDropPreviewActive: active => dockPreviewStates.push(active),
      updateDockDropPreviewWidth: () => {},
    };

    onDrag.call(dialog, { clientX: 50, clientY: 70 });

    assert.equal(element.style.top, undefined);
    assert.equal(element.style.left, undefined);
    assert.equal(dialog._dragAnimationFrame, 17);
    assert.equal(typeof frameCallback, 'function');
    assert.deepEqual(dockPreviewStates, [true]);

    frameCallback();

    assert.equal(element.style.transform, 'translate3d(40px, 50px, 0)');
    assert.deepEqual(dialog._dragPendingPosition, { top: 150, left: 240 });
  } finally {
    globalThis.requestAnimationFrame = previousRequestAnimationFrame;
  }
});

test('docked dialog drag stays docked after returning to the dock edge', () => {
  const onDockedDrag = eval(`(${extractMethod(dialogShellMethodsSource, 'onDockedDrag')})`);
  const endDockedDrag = eval(`(${extractMethod(dialogShellMethodsSource, 'endDockedDrag')})`);
  const previousDocument = globalThis.document;
  const previousRequestAnimationFrame = globalThis.requestAnimationFrame;
  const previousCancelAnimationFrame = globalThis.cancelAnimationFrame;
  let undockCalls = 0;
  let cancelledFrame = null;

  globalThis.document = {
    removeEventListener() {},
  };
  globalThis.requestAnimationFrame = () => 23;
  globalThis.cancelAnimationFrame = frame => {
    cancelledFrame = frame;
  };

  try {
    const dialog = {
      docked: true,
      fullscreen: false,
      element: { style: {} },
      undockDropPreview: { style: {} },
      _dockedDragStart: { x: 20, y: 20 },
      _dockedDragPendingRect: null,
      _dockedDragAnimationFrame: null,
      _dragUndockCandidate: false,
      getDockSnapThreshold: () => 64,
      getDockedDragPreviewRect: (clientX, clientY) => ({
        top: clientY,
        left: clientX,
        width: 800,
        height: 600,
      }),
      setUndockDropPreviewActive(active) {
        this._dragUndockCandidate = Boolean(active && this.docked && !this.fullscreen);
      },
      undockToFloating() {
        undockCalls += 1;
      },
      saveModalPosition() {},
    };

    onDockedDrag.call(dialog, { clientX: 120, clientY: 40 });
    assert.equal(dialog._dragUndockCandidate, true);
    assert.equal(dialog._dockedDragAnimationFrame, 23);

    onDockedDrag.call(dialog, { clientX: 20, clientY: 40 });
    assert.equal(dialog._dragUndockCandidate, false);
    assert.equal(dialog._dockedDragPendingRect, null);

    endDockedDrag.call(dialog);

    assert.equal(undockCalls, 0);
    assert.equal(dialog.docked, true);
    assert.equal(cancelledFrame, 23);
    assert.equal(dialog._dockedDragStart, null);
  } finally {
    globalThis.document = previousDocument;
    globalThis.requestAnimationFrame = previousRequestAnimationFrame;
    globalThis.cancelAnimationFrame = previousCancelAnimationFrame;
  }
});

test('missing browser splitter keeps a compositor preview between live layout frames', () => {
  const previousDocument = globalThis.document;
  const previousRequestAnimationFrame = globalThis.requestAnimationFrame;
  const previousCancelAnimationFrame = globalThis.cancelAnimationFrame;
  const listeners = new Map();
  const frames = [];
  const previews = [];
  const layouts = [];
  let endState = null;

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

  try {
    startSplitterDrag({
      type: 'pointerdown',
      button: 0,
      clientX: 100,
      preventDefault() {},
      stopPropagation() {},
    }, {
      anchor: 'left',
      startWidth: 300,
      bounds: { min: 200, max: 500 },
      dragThreshold: 4,
      layoutFrameStride: 2,
      onPreview: (pending, applied) => previews.push([pending, applied]),
      onDrag: width => layouts.push(width),
      onEnd: (width, state) => {
        endState = { width, ...state };
      },
    });

    listeners.get('pointermove')({
      clientX: 102,
      preventDefault() {},
      stopPropagation() {},
    });
    assert.equal(frames.length, 0, 'movement below the threshold must remain a cheap click');

    listeners.get('pointermove')({
      clientX: 112,
      preventDefault() {},
      stopPropagation() {},
    });
    frames.shift()();
    assert.deepEqual(layouts, []);
    assert.deepEqual(previews.at(-1), [312, 300]);

    frames.shift()();
    assert.deepEqual(layouts, [312]);
    assert.deepEqual(previews.at(-1), [312, 312]);

    listeners.get('pointerup')({
      preventDefault() {},
      stopPropagation() {},
    });
    assert.equal(endState.width, 312);
    assert.equal(endState.didDrag, true);
  } finally {
    globalThis.document = previousDocument;
    globalThis.requestAnimationFrame = previousRequestAnimationFrame;
    globalThis.cancelAnimationFrame = previousCancelAnimationFrame;
  }

  assert.match(missingBrowserMethodsSource, /dragThreshold:\s*4/);
  assert.match(missingBrowserMethodsSource, /layoutFrameStride:\s*1/);
  assert.doesNotMatch(missingBrowserMethodsSource, /translate3d\(/);
  assert.match(
    resolverMainCssSource,
    /\.mr-missing-browser\.is-resizing::after\s*\{[^}]*pointer-events:\s*auto/s
  );
  assert.doesNotMatch(
    resolverMainCssSource,
    /\.mr-missing-browser\.is-resizing \.mr-missing-(?:list|detail)-pane/
  );
  assert.doesNotMatch(missingBrowserMethodsSource, /deferMissingBrowserSplitReleaseUi/);
  assert.match(
    missingBrowserMethodsSource,
    /scheduleMissingBrowserExternalResizeRestore\(browser,\s*observedWidth\)/
  );
  assert.doesNotMatch(missingBrowserMethodsSource, /is-detail-collapsed/);
  assert.doesNotMatch(resolverMainCssSource, /is-detail-collapsed/);
  assert.doesNotMatch(missingBrowserMethodsSource, /startMissingBrowserExternalResizeLock/);
  assert.doesNotMatch(resolverMainCssSource, /mr-resolver-external-resizing/);
  assert.doesNotMatch(
    resolverMainCssSource,
    /@media\s*\(max-width:\s*980px\)\s*\{\s*\.mr-missing-browser/
  );
});

test('docked ComfyUI splitter coalesces live layout while its gutter stays responsive', () => {
  const queueResize = eval(
    `(${extractMethod(dialogShellMethodsSource, 'queueSidebarSplitterResize')})`
  );
  const flushResize = eval(
    `(${extractMethod(dialogShellMethodsSource, 'flushSidebarSplitterResize')})`
  );
  const previousRequestAnimationFrame = globalThis.requestAnimationFrame;
  const previousWindow = globalThis.window;
  const frames = [];
  const originalCalls = [];

  globalThis.requestAnimationFrame = callback => {
    frames.push(callback);
    return frames.length;
  };
  globalThis.window = {
    setTimeout(callback) {
      callback();
      return 1;
    },
  };

  try {
    const gutter = {
      style: {
        transform: '',
        willChange: '',
      },
    };
    const state = {
      proxy: {},
      originalResize(...args) {
        originalCalls.push(args);
      },
      gutter,
      originalTransform: '',
      pendingArgs: null,
      animationFrame: null,
      delayTimer: null,
      lastLayoutAt: Number.NEGATIVE_INFINITY,
      minLayoutInterval: 40,
      appliedPageX: 100,
      appliedPageY: 0,
      vertical: false,
      hasMoved: false,
    };
    const context = {
      _sidebarSplitterDragState: state,
      flushSidebarSplitterResize: flushResize,
    };

    queueResize.call(context, state, [{ pageX: 112, pageY: 0 }]);
    queueResize.call(context, state, [{ pageX: 128, pageY: 0 }]);

    assert.equal(frames.length, 1);
    assert.equal(gutter.style.transform, 'translate3d(28px, 0px, 0)');
    assert.equal(originalCalls.length, 0);

    frames.shift()();
    assert.equal(originalCalls.length, 1);
    assert.equal(originalCalls[0][0].pageX, 128);
    assert.equal(state.appliedPageX, 128);
    assert.equal(gutter.style.transform, '');
  } finally {
    globalThis.requestAnimationFrame = previousRequestAnimationFrame;
    globalThis.window = previousWindow;
  }

  assert.match(dialogShellMethodsSource, /minLayoutInterval:\s*16/);
  assert.match(dialogShellMethodsSource, /setPointerCapture\(event\.pointerId\)/);
  assert.match(dialogShellMethodsSource, /translate3d\(/);
  assert.match(dialogShellMethodsSource, /requestAnimationFrame\(/);
  assert.doesNotMatch(dialogShellMethodsSource, /mr-resolver-external-resizing/);
});

test('queue splitter suppresses tooltips while resizing', () => {
  const activateQueueSplitUi = eval(
    `(${extractMethod(queueMethodsSource, 'activateQueueSplitUi')})`
  );
  const deactivateQueueSplitUi = eval(
    `(${extractMethod(queueMethodsSource, 'deactivateQueueSplitUi')})`
  );
  const classes = new Set();
  const splitterClasses = new Set();
  let hideTooltipCalls = 0;
  const body = {
    classList: {
      add: value => classes.add(value),
      remove: value => classes.delete(value),
    },
  };
  const dialog = {
    _queueSplitUiActive: false,
    splitterElement: {
      classList: {
        add: value => splitterClasses.add(value),
        remove: value => splitterClasses.delete(value),
      },
    },
    hideTooltip() {
      hideTooltipCalls += 1;
    },
  };

  activateQueueSplitUi.call(dialog, body);
  activateQueueSplitUi.call(dialog, body);

  assert.equal(hideTooltipCalls, 1);
  assert.equal(classes.has('is-resizing'), true);
  assert.equal(splitterClasses.has('is-resizing'), true);

  deactivateQueueSplitUi.call(dialog, body);

  assert.equal(dialog._queueSplitUiActive, false);
  assert.equal(classes.has('is-resizing'), false);
  assert.equal(splitterClasses.has('is-resizing'), false);
  assert.match(
    queueMethodsSource,
    /onBeforeDrag:\s*\(newW\)\s*=>\s*\{\s*this\.activateQueueSplitUi\(body\)/
  );
  assert.match(
    queueMethodsSource,
    /onEnd:\s*\(finalWidth\)\s*=>\s*\{[^]*this\.deactivateQueueSplitUi\(body\)/
  );
  assert.match(
    resolverMainCssSource,
    /#model-resolver-body\.is-resizing::after\s*\{[^}]*pointer-events:\s*auto/s
  );
});

test('missing browser detail remains available at narrow widths', () => {
  assert.doesNotMatch(missingBrowserMethodsSource, /updateMissingBrowserDetailCollapse/);
  assert.doesNotMatch(missingBrowserMethodsSource, /is-detail-collapsed/);
  assert.doesNotMatch(resolverMainCssSource, /is-detail-collapsed/);
});

test('missing browser detail follows external splitter resizing every animation frame', () => {
  const scheduleRestore = eval(
    `(${extractMethod(missingBrowserMethodsSource, 'scheduleMissingBrowserExternalResizeRestore')})`
  );
  const previousHTMLElement = globalThis.HTMLElement;
  const previousRequestAnimationFrame = globalThis.requestAnimationFrame;
  const frames = [];
  const restores = [];

  class FakeHTMLElement {}
  globalThis.HTMLElement = FakeHTMLElement;
  globalThis.requestAnimationFrame = callback => {
    frames.push(callback);
    return frames.length;
  };

  try {
    const browser = new FakeHTMLElement();
    browser.isConnected = true;
    const context = {
      _missingBrowserExternalResizeFrame: null,
      _pendingMissingBrowserExternalResizeBrowser: null,
      _pendingMissingBrowserExternalResizeWidth: null,
      _missingBrowserSplitDragging: false,
      restoreMissingBrowserSplitWidth(target, options) {
        restores.push([target, options]);
      },
    };

    scheduleRestore.call(context, browser, 620);
    scheduleRestore.call(context, browser, 540);

    assert.equal(frames.length, 1);
    assert.equal(restores.length, 0);

    frames.shift()();

    assert.equal(restores.length, 1);
    assert.equal(restores[0][0], browser);
    assert.deepEqual(restores[0][1], {
      browserWidth: 540,
      useDefault: false,
    });
  } finally {
    globalThis.HTMLElement = previousHTMLElement;
    globalThis.requestAnimationFrame = previousRequestAnimationFrame;
  }

  assert.doesNotMatch(
    extractMethod(missingBrowserMethodsSource, 'scheduleMissingBrowserExternalResizeRestore'),
    /setTimeout|120/
  );
});

test('missing browser splitter preserves the table through the Type column', () => {
  const getSplitBounds = eval(
    `(${extractMethod(missingBrowserMethodsSource, 'getMissingBrowserSplitBoundsForWidth')})`
  );
  const regularBounds = getSplitBounds(1000);
  const narrowBounds = getSplitBounds(620);

  assert.equal(regularBounds.available - regularBounds.max, 340);
  assert.equal(narrowBounds.available - narrowBounds.max, 340);
  assert.equal(narrowBounds.min, narrowBounds.max);
  assert.match(
    extractMethod(missingBrowserMethodsSource, 'getMissingBrowserSplitBoundsForWidth'),
    /Math\.min\(340,\s*available\)/
  );
  assert.match(
    resolverMainCssSource,
    /\.mr-missing-browser\s*\{[^}]*--mr-missing-list-min-width:\s*340px;/s
  );
  assert.match(
    resolverMainCssSource,
    /\.mr-missing-list-pane\s*\{[^}]*min-width:\s*var\(--mr-missing-list-min-width\);/s
  );
  assert.doesNotMatch(
    resolverMainCssSource,
    /\.mr-missing-row-best,[\s\S]*?\.mr-missing-row-sources\s*\{[^}]*display:\s*none;/
  );
});

test('missing browser keeps the list edge pinned until saved detail width fits', () => {
  const applyDetailWidth = eval(
    `(${extractMethod(missingBrowserMethodsSource, 'applyMissingBrowserDetailWidth')})`
  );
  const previousHTMLElement = globalThis.HTMLElement;

  class FakeHTMLElement {}
  globalThis.HTMLElement = FakeHTMLElement;

  try {
    const pinnedClasses = new Set();
    const browser = new FakeHTMLElement();
    const listPane = new FakeHTMLElement();
    const detailPane = new FakeHTMLElement();
    listPane.isConnected = true;
    listPane.style = { flexBasis: '', flexGrow: '', flexShrink: '' };
    detailPane.style = { flexBasis: '', flexGrow: '', flexShrink: '' };
    browser.classList = {
      contains(name) {
        return pinnedClasses.has(name);
      },
      toggle(name, enabled) {
        if (enabled) pinnedClasses.add(name);
        else pinnedClasses.delete(name);
      },
    };
    browser.querySelector = selector => (
      selector === '.mr-missing-list-pane' ? listPane : detailPane
    );
    detailPane.classList = {
      contains(name) {
        return name === 'mr-missing-detail-pane';
      },
    };
    detailPane.closest = () => browser;

    const context = {
      _missingBrowserSplitListPane: listPane,
      _missingBrowserLastDetailWidth: null,
    };

    applyDetailWidth.call(context, detailPane, 420, {
      splitBounds: { min: 270, max: 300, available: 640 },
    });

    assert.equal(pinnedClasses.has('is-list-pinned'), true);
    assert.equal(detailPane.style.flexBasis, '420px');
    assert.equal(context._missingBrowserLastDetailWidth, 300);

    applyDetailWidth.call(context, detailPane, 420, {
      splitBounds: { min: 300, max: 450, available: 790 },
    });

    assert.equal(pinnedClasses.has('is-list-pinned'), false);
    assert.equal(detailPane.style.flexBasis, '420px');
  } finally {
    globalThis.HTMLElement = previousHTMLElement;
  }

  assert.match(
    resolverMainCssSource,
    /\.mr-missing-browser\.is-list-pinned \.mr-missing-list-pane\s*\{[^}]*flex:\s*0 0 var\(--mr-missing-list-min-width\) !important;/s
  );
  assert.match(
    resolverMainCssSource,
    /\.mr-missing-browser\.is-list-pinned \.mr-missing-detail-pane\s*\{[^}]*flex:\s*1 1 0 !important;/s
  );
});

test('local and loaded model tooltips include preview image routes above full names', () => {
  const getModelPreviewTooltipAttrs = eval(`(${extractMethod(renderFormatMethodsSource, 'getModelPreviewTooltipAttrs')})`);
  const previousApi = globalThis.api;
  globalThis.api = {
    apiURL(route) {
      return `/comfy${route}`;
    },
  };

  try {
    const attrs = getModelPreviewTooltipAttrs.call({
      escapeHtml(value) {
        return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
      },
    }, {
      resolved_path: 'E:\\AI Models\\KREA2\\model.safetensors',
    }, 'KREA2\\model.safetensors');

    assert.match(attrs, /data-tooltip="KREA2\\model\.safetensors"/);
    assert.match(
      attrs,
      /data-tooltip-image="\/comfy\/model_resolver\/model-preview\?path=E%3A%5CAI%20Models%5CKREA2%5Cmodel\.safetensors"/
    );
    assert.match(searchPanelMethodsSource, /mr-match-filename[^]*getModelPreviewTooltipAttrs/);
    assert.match(tabsLoadedMethodsSource, /mr-model-chip[^]*getModelPreviewTooltipAttrs/);
  } finally {
    if (previousApi === undefined) {
      delete globalThis.api;
    } else {
      globalThis.api = previousApi;
    }
  }
});

test('model tooltip stays hidden while the context menu is visible', () => {
  const showTooltip = eval(`(${extractMethod(searchPanelMethodsSource, 'showTooltip')})`);
  const calls = [];
  const dialog = {
    contextMenu: { style: { display: 'block' } },
    tooltipElement: {},
    hideTooltip() {
      calls.push('hide');
    },
    normalizeTooltipTarget() {
      calls.push('normalize');
    },
  };

  showTooltip.call(dialog, {});

  assert.deepEqual(calls, ['hide']);
  assert.match(
    modelInfoMethodsSource,
    /showContextMenu\(x, y, model\)[^]*this\.hideTooltip\?\.\(\)/
  );
});

test('model tooltip revalidates and detects video previews from the preview route', async () => {
  const getTooltipPreviewMediaType = eval(`(${extractMethod(searchPanelMethodsSource, 'getTooltipPreviewMediaType')})`);
  const previousFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return {
      ok: true,
      headers: {
        get(name) {
          return name.toLowerCase() === 'content-type' ? 'video/mp4' : '';
        },
      },
    };
  };

  try {
    const dialog = {};
    const previewUrl = '/model_resolver/model-preview?path=model.safetensors';
    assert.equal(
      await getTooltipPreviewMediaType.call(dialog, previewUrl),
      'video'
    );
    assert.equal(
      await getTooltipPreviewMediaType.call(dialog, previewUrl),
      'video'
    );
    assert.equal(fetchCalls, 2);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('Show info uses the local preview route and renders video media', () => {
  const isInfoPreviewVideo = eval(`(${extractMethod(modelInfoMethodsSource, 'isInfoPreviewVideo')})`);
  const getInfoDialogMedia = eval(`(${extractMethod(modelInfoMethodsSource, 'getInfoDialogMedia')})`);
  const renderInfoPreviewMedia = eval(`(${extractMethod(modelInfoMethodsSource, 'renderInfoPreviewMedia')})`);
  const previousApi = globalThis.api;
  globalThis.api = {
    apiURL(route) {
      return `/comfy${route}`;
    },
  };

  try {
    const dialog = {
      isInfoPreviewVideo,
      getModelInfoResolvedPath(data) {
        return data.resolved_path || '';
      },
      escapeHtml(value) {
        return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
      },
    };
    const media = getInfoDialogMedia.call(dialog, {
      resolved_path: 'E:\\Models\\video-model.safetensors',
      preview_url: 'E:/Models/video-model.mp4',
      images: [{
        url: 'https://image.civitai.com/original=true/12345.mp4',
        type: 'video',
        seed: 123,
      }],
    });

    assert.equal(media.length, 1);
    assert.equal(media[0].type, 'video');
    assert.equal(media[0].seed, 123);
    assert.match(
      media[0].url,
      /^\/comfy\/model_resolver\/model-preview\?path=E%3A%5CModels%5Cvideo-model\.safetensors$/
    );
    assert.equal(isInfoPreviewVideo({ url: media[0].url, type: 'video' }), true);

    const thumbnail = renderInfoPreviewMedia.call(dialog, media[0], { thumbnail: true });
    const fullPreview = renderInfoPreviewMedia.call(dialog, media[0]);
    assert.match(thumbnail, /^<video /);
    assert.match(thumbnail, /autoplay muted loop playsinline/);
    assert.match(thumbnail, /draggable="false"/);
    assert.doesNotMatch(thumbnail, / controls/);
    assert.match(fullPreview, / controls autoplay muted loop playsinline/);
    assert.match(
      modelInfoMethodsSource,
      /renderSourceModelDetails\(data = \{\}, contextModel = \{\}\)[^]*renderInfoPreviewMedia\(image, \{ thumbnail: true \}\)/
    );
  } finally {
    if (previousApi === undefined) {
      delete globalThis.api;
    } else {
      globalThis.api = previousApi;
    }
  }
});

test('CivitAI Comfy workflow metadata is extracted as pasteable JSON', () => {
  const workflow = {
    last_node_id: 2,
    nodes: [
      { id: 1, type: 'CheckpointLoaderSimple' },
      { id: 2, type: 'KSampler' },
    ],
    links: [],
  };

  const result = extractComfyWorkflow({
    metadata: {
      comfy: JSON.stringify(workflow),
    },
  });

  assert.equal(result.nodeCount, 2);
  assert.deepEqual(JSON.parse(result.text), workflow);
});

test('CivitAI Comfy workflow metadata supports nested and double-encoded JSON', () => {
  const workflow = {
    nodes: [{ id: 7, type: 'SaveImage' }],
    links: [],
  };
  const result = extractComfyWorkflow({
    metadata: {
      extra_pnginfo: JSON.stringify({
        workflow: JSON.stringify(JSON.stringify(workflow)),
      }),
    },
  });

  assert.equal(result.nodeCount, 1);
  assert.deepEqual(result.workflow, workflow);
});

test('CivitAI Comfy workflow metadata tolerates non-finite Python JSON numbers', () => {
  const result = extractComfyWorkflow({
    metadata: {
      comfy: '{"prompt":{},"workflow":{"nodes":[{"id":1,"type":"KSampler","widgets_values":[NaN,"NaN",Infinity,-Infinity]}],"links":[]}}',
    },
  });

  assert.equal(result.nodeCount, 1);
  assert.deepEqual(result.workflow.nodes[0].widgets_values, [null, 'NaN', null, null]);
  assert.deepEqual(JSON.parse(result.text), result.workflow);
});

test('API prompt metadata is not offered as a pasteable editor workflow', () => {
  const result = extractComfyWorkflow({
    metadata: {
      comfy: {
        1: {
          class_type: 'KSampler',
          inputs: {},
        },
      },
    },
  });

  assert.equal(result, null);
});

test('node context menu includes only existing resolved models from the selected node scope', () => {
  const data = {
    resolved_models: [
      {
        node_id: 42,
        widget_index: 0,
        widget_name: 'ckpt_name',
        original_path: 'models/checkpoint.safetensors',
        full_path: 'E:\\models\\checkpoint.safetensors',
        category: 'checkpoints',
        exists: true,
        is_top_level: true,
      },
      {
        node_id: 42,
        widget_index: 1,
        widget_name: 'vae_name',
        original_path: 'vae.safetensors',
        full_path: 'E:\\models\\vae\\vae.safetensors',
        category: 'vae',
        exists: false,
        is_top_level: true,
      },
      {
        node_id: 42,
        widget_index: 0,
        original_path: 'nested.safetensors',
        full_path: 'E:\\models\\nested.safetensors',
        category: 'checkpoints',
        exists: true,
        is_top_level: false,
        subgraph_id: 'subgraph-a',
      },
      {
        node_id: 99,
        widget_index: 0,
        original_path: 'other.safetensors',
        full_path: 'E:\\models\\other.safetensors',
        category: 'checkpoints',
        exists: true,
        is_top_level: true,
      },
    ],
  };

  const models = getResolvedModelsForNode(data, 42, { is_top_level: true });

  assert.equal(models.length, 1);
  assert.equal(models[0].widget_name, 'ckpt_name');
});

test('node context menu immediately reflects a newly selected valid widget model', () => {
  const previousModel = {
    node_id: 42,
    widget_index: 0,
    widget_name: 'ckpt_name',
    original_path: 'old-model.safetensors',
    full_path: 'E:\\models\\old-model.safetensors',
    category: 'checkpoints',
    exists: true,
    is_top_level: true,
  };
  const node = {
    id: 42,
    widgets: [{
      value: 'new-model.safetensors',
      options: {
        values: ['old-model.safetensors', 'new-model.safetensors'],
      },
    }],
  };

  const models = getImmediateModelsForNode(
    { resolved_models: [previousModel] },
    node,
    { is_top_level: true }
  );
  const menu = buildModelResolverNodeMenu(models);

  assert.equal(models.length, 1);
  assert.equal(models[0].original_path, 'new-model.safetensors');
  assert.equal(models[0].resolution_pending, true);
  assert.equal(models[0].full_path, '');
  assert.equal(menu.title, 'Model Resolver');
});

test('immediate node context model ignores a value outside the widget choices', () => {
  const models = getImmediateModelsForNode({
    resolved_models: [{
      node_id: 7,
      widget_index: 0,
      original_path: 'old-model.safetensors',
      full_path: 'E:\\models\\old-model.safetensors',
      category: 'checkpoints',
      exists: true,
      is_top_level: true,
    }],
  }, {
    id: 7,
    widgets: [{
      value: 'not-in-dropdown.safetensors',
      options: { values: ['old-model.safetensors'] },
    }],
  }, {
    is_top_level: true,
  });

  assert.deepEqual(models, []);
});

test('node context menu groups multiple model inputs and dispatches actions for the selected model', () => {
  const calls = [];
  const models = [
    {
      node_id: 7,
      widget_index: 0,
      widget_name: 'ckpt_name',
      original_path: 'model.safetensors',
      full_path: 'E:\\models\\model.safetensors',
      category: 'checkpoints',
      exists: true,
    },
    {
      node_id: 7,
      widget_index: 1,
      widget_name: 'vae_name',
      original_path: 'vae.safetensors',
      full_path: 'E:\\models\\vae\\vae.safetensors',
      category: 'vae',
      exists: true,
    },
  ];
  const menu = buildModelResolverNodeMenu(models, {
    showInResolver: model => calls.push(['show', model.widget_name]),
    showInfo: model => calls.push(['info', model.widget_name]),
    openContainingFolder: model => calls.push(['folder', model.widget_name]),
  }, {
    formatCategory: category => category === 'checkpoints' ? 'Checkpoint' : category,
  });

  assert.equal(menu.title, 'Model Resolver');
  assert.equal(menu.className, 'mdi mdi-link-variant mr-model-resolver-node-menu');
  assert.equal(menu.submenu.options.length, 2);
  assert.match(menu.submenu.options[0].title, /^CHECKPOINT · ckpt_name/);
  assert.match(menu.submenu.options[1].title, /^VAE · vae_name/);
  assert.deepEqual(
    menu.submenu.options[0].submenu.options.map(option => option.content),
    ['Show in Model Resolver', 'Show info', 'Open containing folder']
  );

  menu.submenu.options[1].submenu.options[2].callback();
  assert.deepEqual(calls, [['folder', 'vae_name']]);
});

test('node context menu uses direct actions for one model and converts its local path for resolver actions', () => {
  const model = {
    node_id: 5,
    widget_index: 2,
    original_path: 'folder/model.gguf',
    full_path: 'E:\\models\\folder\\model.gguf',
    category: 'diffusion_models',
    exists: true,
  };
  const menu = buildModelResolverNodeMenu([model]);
  const contextModel = toResolverContextModel(model);

  assert.deepEqual(
    menu.submenu.options.map(option => option.content),
    ['Show in Model Resolver', 'Show info', 'Open containing folder']
  );
  assert.equal(contextModel.name, 'model.gguf');
  assert.equal(contextModel.path, model.full_path);
  assert.equal(contextModel.resolved_path, model.full_path);
});

test('workflow model reference matching distinguishes widget, path, and subgraph scope', () => {
  const model = {
    node_id: 11,
    widget_index: 3,
    original_path: 'Folder\\Model.safetensors',
    is_top_level: false,
    subgraph_id: 'subgraph-a',
  };

  assert.equal(matchesWorkflowModelReference(model, {
    node_id: '11',
    widget_index: 3,
    original_path: 'folder/model.safetensors',
    is_top_level: false,
    subgraph_id: 'subgraph-a',
  }), true);
  assert.equal(matchesWorkflowModelReference(model, {
    node_id: 11,
    widget_index: 4,
  }), false);
  assert.equal(matchesWorkflowModelReference(model, {
    node_id: 11,
    widget_index: 3,
    subgraph_id: 'subgraph-b',
  }), false);
});

test('node context integration preserves existing menu hooks and refreshes after widget changes', () => {
  const configureNodeContextMenu = eval(`(${extractMethod(modelResolverSource, 'configureNodeContextMenu')})`);
  const calls = [];
  class NodeType {}
  NodeType.prototype.getExtraMenuOptions = function(_canvas, options) {
    calls.push('original-menu');
    options.push({ content: 'Original action' });
    return options;
  };
  NodeType.prototype.onWidgetChanged = function(name) {
    calls.push(`original-widget:${name}`);
    return 'widget-result';
  };

  const model = {
    node_id: 7,
    widget_index: 0,
    widget_name: 'ckpt_name',
    original_path: 'model.safetensors',
    full_path: 'E:\\models\\model.safetensors',
    category: 'checkpoints',
    exists: true,
  };
  const resolver = {
    getResolvedModelsForNodeContextMenu: () => [model],
    scheduleNodeContextMenuAnalysis: () => calls.push('refresh'),
    showResolvedNodeModelInResolver: () => {},
    dialog: {
      scheduleActiveWorkflowRefresh: reason => calls.push(`dialog-refresh:${reason}`),
      getCategoryDisplayName: () => 'checkpoint',
      showModelInfo: () => {},
      openContainingFolder: () => {},
    },
  };

  configureNodeContextMenu.call(resolver, NodeType);
  const node = new NodeType();
  const options = [];
  const result = node.getExtraMenuOptions(null, options);

  assert.equal(result, options);
  assert.equal(options[0].title, 'Model Resolver');
  assert.equal(options[0].className, 'mdi mdi-link-variant mr-model-resolver-node-menu');
  assert.equal(options[1].content, 'Original action');
  assert.equal(node.onWidgetChanged('ckpt_name'), 'widget-result');
  assert.deepEqual(calls, [
    'original-menu',
    'original-widget:ckpt_name',
    'refresh',
    'dialog-refresh:node-widget-change',
  ]);
});

test('node context integration injects the menu when a node overrides getMenuOptions', () => {
  const configureNodeContextMenu = eval(`(${extractMethod(modelResolverSource, 'configureNodeContextMenu')})`);
  class NodeType {}
  NodeType.prototype.getMenuOptions = function() {
    return [{ content: 'Native subgraph action' }];
  };

  const resolver = {
    getResolvedModelsForNodeContextMenu: () => [{
      node_id: 30,
      widget_index: 0,
      original_path: 'model.safetensors',
      full_path: 'E:\\models\\model.safetensors',
      category: 'checkpoints',
      exists: true,
    }],
    showResolvedNodeModelInResolver: () => {},
    resolveNodeContextMenuModel: model => model,
    dialog: {
      getCategoryDisplayName: () => 'checkpoint',
      showModelInfo: () => {},
      openContainingFolder: () => {},
    },
  };

  configureNodeContextMenu.call(resolver, NodeType);
  const options = new NodeType().getMenuOptions(null);

  assert.equal(options[0].title, 'Model Resolver');
  assert.equal(options[1].content, 'Native subgraph action');
});

test('node context integration patches instance menu hooks installed by subgraph handlers', () => {
  const configureNodeContextMenu = eval(`(${extractMethod(modelResolverSource, 'configureNodeContextMenu')})`);
  class NodeType {}
  const node = new NodeType();
  node.getExtraMenuOptions = function(_canvas, options) {
    options.push({ content: 'Native subgraph action' });
    return [];
  };

  const resolver = {
    getResolvedModelsForNodeContextMenu: () => [{
      node_id: 31,
      widget_index: 0,
      original_path: 'model.safetensors',
      full_path: 'E:\\models\\model.safetensors',
      category: 'checkpoints',
      exists: true,
    }],
    showResolvedNodeModelInResolver: () => {},
    resolveNodeContextMenuModel: model => model,
    dialog: {
      getCategoryDisplayName: () => 'checkpoint',
      showModelInfo: () => {},
      openContainingFolder: () => {},
    },
  };

  configureNodeContextMenu.call(resolver, NodeType);
  configureNodeContextMenu.call(resolver, node);
  const options = [];
  node.getExtraMenuOptions(null, options);

  assert.equal(options[0].title, 'Model Resolver');
  assert.equal(options[1].content, 'Native subgraph action');
});

test('node context scope identifies an outer subgraph instance', () => {
  const getSubgraphDefinitionIdForNode = eval(
    `(${extractMethod(modelResolverSource, 'getSubgraphDefinitionIdForNode')})`
  );
  const getNodeContextScope = eval(
    `(${extractMethod(modelResolverSource, 'getNodeContextScope')})`
  );
  const rootGraph = {};
  const previousApp = globalThis.app;
  globalThis.app = { graph: rootGraph };

  try {
    const scope = getNodeContextScope.call(
      { getSubgraphDefinitionIdForNode },
      { type: 'subgraph-a', graph: rootGraph },
      { definitions: { subgraphs: [{ id: 'subgraph-a' }] } },
    );

    assert.deepEqual(scope, {
      is_top_level: true,
      subgraph_id: 'subgraph-a',
      subgraph_instance_id: 'subgraph-a',
      is_subgraph_instance: true,
    });
  } finally {
    if (previousApp === undefined) {
      delete globalThis.app;
    } else {
      globalThis.app = previousApp;
    }
  }
});

test('model tooltip ignores missing preview probes without creating a broken media request', async () => {
  const getTooltipPreviewMediaType = eval(`(${extractMethod(searchPanelMethodsSource, 'getTooltipPreviewMediaType')})`);
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    headers: {
      get() {
        return '';
      },
    },
  });

  try {
    const dialog = {};
    assert.equal(
      await getTooltipPreviewMediaType.call(dialog, '/model_resolver/model-preview?path=missing.safetensors'),
      null
    );
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('custom node registry exposes normalized LoRA Manager entries', () => {
  const node = {
    comfyClass: 'Lora Loader (LoraManager)',
    widgets: [{
      name: 'loras',
      value: [
        'plain.safetensors',
        { name: 'weighted.safetensors', strength: '0.65', active: false },
      ],
    }],
  };

  assert.equal(getCustomNodeModelAdapter(node)?.id, 'lora-manager');
  assert.deepEqual(getCustomNodeModelEntries(node), [
    {
      identity: 'plain.safetensors',
      active: true,
      strength: null,
    },
    {
      identity: 'weighted.safetensors',
      active: false,
      strength: 0.65,
    },
  ]);
});

test('LoRA Manager adapter refreshes analysis only after its model list changes', () => {
  const configureCustomNodeModelAdapter = eval(
    `(${extractMethod(modelResolverSource, 'configureCustomNodeModelAdapter')})`
  );
  const getCustomNodeModelListSignature = eval(
    `(${extractMethod(modelResolverSource, 'getCustomNodeModelListSignature')})`
  );
  const getCustomNodeModelStrengthSignature = eval(
    `(${extractMethod(modelResolverSource, 'getCustomNodeModelStrengthSignature')})`
  );
  const calls = [];
  const lorasWidget = {
    name: 'loras',
    value: [],
    callback(value) {
      calls.push(['original-loras', value]);
      return 'callback-result';
    },
  };
  const textWidget = {
    name: 'text',
    callback(value) {
      calls.push(['original-text', value]);
      if (value === '<lora:second:1>') {
        lorasWidget.value = [
          ...lorasWidget.value,
          { name: 'second', strength: 1, active: true },
        ];
      }
    },
  };
  const unrelatedWidget = {
    name: 'seed',
    callback() {
      calls.push(['unrelated']);
    },
  };
  const resolver = {
    customNodeModelAdapterStates: new WeakMap(),
    getCustomNodeModelListSignature,
    getCustomNodeModelStrengthSignature,
    scheduleNodeContextMenuAnalysis: () => calls.push(['context-analysis']),
    dialog: {
      isWorkflowRefreshSuppressed: () => false,
      scheduleActiveWorkflowRefresh: reason => calls.push(['dialog-refresh', reason]),
    },
  };
  const node = {
    comfyClass: 'Lora Loader (LoraManager)',
    widgets: [textWidget, lorasWidget, unrelatedWidget],
  };

  configureCustomNodeModelAdapter.call(resolver, node);
  lorasWidget.value = [{ name: 'existing', strength: 1, active: true }];
  configureCustomNodeModelAdapter.call(resolver, node);

  textWidget.callback('<lora:second');
  lorasWidget.value = [{ name: 'existing', strength: 0.5, active: true }];
  assert.equal(lorasWidget.callback(lorasWidget.value), 'callback-result');
  textWidget.callback('<lora:second:1>');
  unrelatedWidget.callback();
  assert.deepEqual(calls, [
    ['original-text', '<lora:second'],
    ['original-loras', [{ name: 'existing', strength: 0.5, active: true }]],
    ['original-text', '<lora:second:1>'],
    ['context-analysis'],
    ['dialog-refresh', 'node-widget-change'],
    ['unrelated'],
  ]);
});

test('custom node adapter refresh respects internal workflow update suppression', () => {
  const configureCustomNodeModelAdapter = eval(
    `(${extractMethod(modelResolverSource, 'configureCustomNodeModelAdapter')})`
  );
  const getCustomNodeModelListSignature = eval(
    `(${extractMethod(modelResolverSource, 'getCustomNodeModelListSignature')})`
  );
  const getCustomNodeModelStrengthSignature = eval(
    `(${extractMethod(modelResolverSource, 'getCustomNodeModelStrengthSignature')})`
  );
  const calls = [];
  const widget = {
    name: 'loras',
    value: [],
    callback: () => calls.push('original'),
  };
  const resolver = {
    customNodeModelAdapterStates: new WeakMap(),
    getCustomNodeModelListSignature,
    getCustomNodeModelStrengthSignature,
    scheduleNodeContextMenuAnalysis: () => calls.push('context-analysis'),
    dialog: {
      isWorkflowRefreshSuppressed: () => true,
      scheduleActiveWorkflowRefresh: () => calls.push('dialog-refresh'),
    },
  };

  configureCustomNodeModelAdapter.call(resolver, {
    comfyClass: 'Lora Stacker (LoraManager)',
    widgets: [widget],
  });
  widget.value = [{ name: 'new-lora', strength: 1, active: true }];
  widget.callback(widget.value);

  assert.deepEqual(calls, ['original']);
});

test('rgthree Power Lora Loader updates strength without reloading workflow analysis', async () => {
  const configureCustomNodeModelAdapter = eval(
    `(${extractMethod(modelResolverSource, 'configureCustomNodeModelAdapter')})`
  );
  const getCustomNodeModelListSignature = eval(
    `(${extractMethod(modelResolverSource, 'getCustomNodeModelListSignature')})`
  );
  const getCustomNodeModelStrengthSignature = eval(
    `(${extractMethod(modelResolverSource, 'getCustomNodeModelStrengthSignature')})`
  );
  const calls = [];
  const node = {
    comfyClass: 'Power Lora Loader (rgthree)',
    widgets: [{
      name: 'lora_1',
      value: {
        on: true,
        lora: 'existing.safetensors',
        strength: 1,
      },
    }],
    setDirtyCanvas() {
      calls.push('dirty');
    },
  };
  const resolver = {
    customNodeModelAdapterStates: new WeakMap(),
    getCustomNodeModelListSignature,
    getCustomNodeModelStrengthSignature,
    scheduleNodeContextMenuAnalysis: () => calls.push('context-analysis'),
    dialog: {
      isWorkflowRefreshSuppressed: () => false,
      updateLoadedModelStrengthsFromNode: () => calls.push('loaded-strength-update'),
      scheduleActiveWorkflowRefresh: reason => calls.push(`dialog-refresh:${reason}`),
    },
  };

  configureCustomNodeModelAdapter.call(resolver, node);

  node.widgets[0].value.strength = 0.5;
  node.setDirtyCanvas(true, true);
  await Promise.resolve();

  node.widgets.push({
    name: 'lora_2',
    value: {
      on: true,
      lora: 'new-model.safetensors',
      strength: 1,
    },
  });
  node.setDirtyCanvas(true, true);
  await Promise.resolve();

  assert.deepEqual(calls, [
    'dirty',
    'loaded-strength-update',
    'dirty',
    'context-analysis',
    'dialog-refresh:node-widget-change',
  ]);
});

test('rgthree Power Lora Loader detects removals made through its context menu', async () => {
  const configureCustomNodeModelAdapter = eval(
    `(${extractMethod(modelResolverSource, 'configureCustomNodeModelAdapter')})`
  );
  const getCustomNodeModelListSignature = eval(
    `(${extractMethod(modelResolverSource, 'getCustomNodeModelListSignature')})`
  );
  const getCustomNodeModelStrengthSignature = eval(
    `(${extractMethod(modelResolverSource, 'getCustomNodeModelStrengthSignature')})`
  );
  const calls = [];
  const node = {
    comfyClass: 'Power Lora Loader (rgthree)',
    widgets: [
      {
        name: 'lora_1',
        value: { on: true, lora: 'first.safetensors', strength: 1 },
      },
      {
        name: 'lora_2',
        value: { on: true, lora: 'second.safetensors', strength: 1 },
      },
    ],
    setDirtyCanvas() {},
  };
  const resolver = {
    customNodeModelAdapterStates: new WeakMap(),
    getCustomNodeModelListSignature,
    getCustomNodeModelStrengthSignature,
    scheduleNodeContextMenuAnalysis: () => calls.push('context-analysis'),
    dialog: {
      isWorkflowRefreshSuppressed: () => false,
      scheduleActiveWorkflowRefresh: reason => calls.push(`dialog-refresh:${reason}`),
    },
  };

  configureCustomNodeModelAdapter.call(resolver, node);
  node.widgets.splice(1, 1);
  await Promise.resolve();

  assert.deepEqual(calls, [
    'context-analysis',
    'dialog-refresh:node-widget-change',
  ]);
});

test('rgthree dynamic lora widgets bypass the generic full workflow refresh', () => {
  const configureNodeContextMenu = eval(
    `(${extractMethod(modelResolverSource, 'configureNodeContextMenu')})`
  );
  const isCustomNodeModelWidget = eval(
    `(${extractMethod(modelResolverSource, 'isCustomNodeModelWidget')})`
  );
  const calls = [];
  class NodeType {}
  NodeType.prototype.comfyClass = 'Power Lora Loader (rgthree)';
  NodeType.prototype.onWidgetChanged = function(name) {
    calls.push(`original:${name}`);
  };
  const node = new NodeType();
  const resolver = {
    customNodeModelAdapterStates: new WeakMap([
      [node, { notify: () => calls.push('selective-update') }],
    ]),
    getResolvedModelsForNodeContextMenu: () => [],
    isCustomNodeModelWidget,
    scheduleNodeContextMenuAnalysis: () => calls.push('context-analysis'),
    dialog: {
      isWorkflowRefreshSuppressed: () => false,
      isWorkflowStrengthWidgetName: () => false,
      scheduleActiveWorkflowRefresh: () => calls.push('dialog-refresh'),
    },
  };

  configureNodeContextMenu.call(resolver, NodeType);
  node.onWidgetChanged('lora_1');

  assert.deepEqual(calls, [
    'original:lora_1',
    'selective-update',
  ]);
});

test('LoRA Manager text onWidgetChanged waits for a confirmed model-list change', () => {
  const configureNodeContextMenu = eval(`(${extractMethod(modelResolverSource, 'configureNodeContextMenu')})`);
  const calls = [];
  class NodeType {}
  NodeType.prototype.onWidgetChanged = function(name) {
    calls.push(`original:${name}`);
  };
  const resolver = {
    getResolvedModelsForNodeContextMenu: () => [],
    isCustomNodeModelWidget: (_node, widgetName) => widgetName === 'text',
    scheduleNodeContextMenuAnalysis: () => calls.push('context-analysis'),
    dialog: {
      isWorkflowRefreshSuppressed: () => false,
      isWorkflowStrengthWidgetName: () => false,
      scheduleActiveWorkflowRefresh: () => calls.push('dialog-refresh'),
    },
  };

  configureNodeContextMenu.call(resolver, NodeType);
  new NodeType().onWidgetChanged('text');

  assert.deepEqual(calls, ['original:text']);
});

test('strength widget changes skip proactive node context analysis', () => {
  const configureNodeContextMenu = eval(`(${extractMethod(modelResolverSource, 'configureNodeContextMenu')})`);
  const isWorkflowStrengthWidgetName = eval(
    `(${extractMethod(workflowStateMethodsSource, 'isWorkflowStrengthWidgetName')})`
  );
  const calls = [];
  class NodeType {}
  const resolver = {
    getResolvedModelsForNodeContextMenu: () => [],
    scheduleNodeContextMenuAnalysis: () => calls.push('context-analysis'),
    dialog: {
      isWorkflowStrengthWidgetName,
      scheduleActiveWorkflowRefresh: reason => calls.push(`dialog-refresh:${reason}`),
    },
  };

  configureNodeContextMenu.call(resolver, NodeType);
  const node = new NodeType();
  node.onWidgetChanged('strength_model');
  node.onWidgetChanged('lora_2_clip_strength');

  assert.deepEqual(calls, [
    'dialog-refresh:node-widget-change',
    'dialog-refresh:node-widget-change',
  ]);
});

test('internally applied widget changes suppress duplicate workflow analysis hooks', () => {
  const configureNodeContextMenu = eval(`(${extractMethod(modelResolverSource, 'configureNodeContextMenu')})`);
  const calls = [];
  class NodeType {}
  NodeType.prototype.onWidgetChanged = function(name) {
    calls.push(`original-widget:${name}`);
  };
  const resolver = {
    getResolvedModelsForNodeContextMenu: () => [],
    scheduleNodeContextMenuAnalysis: () => calls.push('context-analysis'),
    dialog: {
      isWorkflowRefreshSuppressed: () => true,
      isWorkflowStrengthWidgetName: () => false,
      scheduleActiveWorkflowRefresh: reason => calls.push(`dialog-refresh:${reason}`),
    },
  };

  configureNodeContextMenu.call(resolver, NodeType);
  new NodeType().onWidgetChanged('ckpt_name');

  assert.deepEqual(calls, ['original-widget:ckpt_name']);
});

test('Apply updates only linked top-level widgets without reconfiguring the graph', async () => {
  const cloneWorkflowWidgetValue = eval(
    `(${extractMethod(workflowUpdateMethodsSource, 'cloneWorkflowWidgetValue')})`
  );
  const findWorkflowNodeForResolution = eval(
    `(${extractMethod(workflowUpdateMethodsSource, 'findWorkflowNodeForResolution')})`
  );
  const applyWorkflowResolutionValuesToGraph = eval(
    `(${extractMethod(workflowUpdateMethodsSource, 'applyWorkflowResolutionValuesToGraph')})`
  );
  const isWorkflowRefreshSuppressed = eval(
    `(${extractMethod(workflowUpdateMethodsSource, 'isWorkflowRefreshSuppressed')})`
  );
  const runWithWorkflowRefreshSuppressed = eval(
    `(${extractMethod(workflowUpdateMethodsSource, 'runWithWorkflowRefreshSuppressed')})`
  );
  const updateWorkflowInComfyUI = eval(
    `(${extractMethod(workflowUpdateMethodsSource, 'updateWorkflowInComfyUI')})`
  );
  const previousApp = globalThis.app;
  const calls = [];
  const graphNode = {
    id: 7,
    widgets: [{ name: 'ckpt_name', value: 'old.safetensors' }],
    widgets_values: ['old.safetensors'],
    onWidgetChanged(name, value, oldValue) {
      calls.push(`widget:${name}:${oldValue}->${value}`);
      calls.push(`suppressed:${dialog.isWorkflowRefreshSuppressed()}`);
    },
  };
  globalThis.app = {
    graph: {
      nodes: [graphNode],
      getNodeById: id => String(id) === '7' ? graphNode : null,
      beforeChange: () => calls.push('before'),
      afterChange: () => calls.push('after'),
      setDirtyCanvas: () => calls.push('dirty'),
      configure: () => calls.push('configure'),
    },
  };
  const dialog = {
    cloneWorkflowWidgetValue,
    findWorkflowNodeForResolution,
    applyWorkflowResolutionValuesToGraph,
    isWorkflowRefreshSuppressed,
    runWithWorkflowRefreshSuppressed,
  };
  const workflow = {
    nodes: [{ id: 7, widgets_values: ['SD15\\realisticVision.safetensors'] }],
  };
  const resolutions = [{ node_id: 7, widget_index: 0, is_top_level: true }];

  try {
    const updated = await updateWorkflowInComfyUI.call(dialog, workflow, resolutions);

    assert.equal(updated, true);
    assert.equal(graphNode.widgets[0].value, 'SD15\\realisticVision.safetensors');
    assert.equal(graphNode.widgets_values[0], 'SD15\\realisticVision.safetensors');
    assert.equal(dialog.isWorkflowRefreshSuppressed(), false);
    assert.deepEqual(calls, [
      'before',
      'widget:ckpt_name:old.safetensors->SD15\\realisticVision.safetensors',
      'suppressed:true',
      'after',
      'dirty',
    ]);
  } finally {
    if (previousApp === undefined) {
      delete globalThis.app;
    } else {
      globalThis.app = previousApp;
    }
  }
});

test('Apply defers model catalog refresh until after the linking path returns', async () => {
  const scheduleComfyModelCatalogRefreshAfterApply = eval(
    `(${extractMethod(workflowUpdateMethodsSource, 'scheduleComfyModelCatalogRefreshAfterApply')})`
  );
  const runWithWorkflowRefreshSuppressed = eval(
    `(${extractMethod(workflowUpdateMethodsSource, 'runWithWorkflowRefreshSuppressed')})`
  );
  const calls = [];
  let finish;
  const finished = new Promise(resolve => {
    finish = resolve;
  });
  const dialog = {
    runWithWorkflowRefreshSuppressed,
    async refreshComfyModelCatalogAfterApply() {
      calls.push('catalog');
      return true;
    },
    scheduleActiveWorkflowRefresh(reason) {
      calls.push(`refresh:${reason}`);
      finish();
    },
  };

  scheduleComfyModelCatalogRefreshAfterApply.call(dialog, { nodes: [] }, []);
  assert.deepEqual(calls, []);

  await finished;
  assert.deepEqual(calls, ['catalog', 'refresh:node-widget-change']);
});

test('Apply does not schedule a duplicate workflow refresh when analysis is already current', async () => {
  const scheduleComfyModelCatalogRefreshAfterApply = eval(
    `(${extractMethod(workflowUpdateMethodsSource, 'scheduleComfyModelCatalogRefreshAfterApply')})`
  );
  const calls = [];
  let finish;
  const finished = new Promise(resolve => {
    finish = resolve;
  });
  const workflow = { nodes: [{ id: 7, widgets_values: ['linked.safetensors'] }] };
  const dialog = {
    runWithWorkflowRefreshSuppressed: async callback => callback(),
    cachedWorkflowSignature: 'current-signature',
    cachedAnalysisData: { missing_models: [], resolved_models: [] },
    getMissingWorkflowSignature(value) {
      assert.equal(value, workflow);
      return 'current-signature';
    },
    async refreshComfyModelCatalogAfterApply() {
      calls.push('catalog');
      return true;
    },
    scheduleActiveWorkflowRefresh() {
      calls.push('refresh');
    },
  };

  scheduleComfyModelCatalogRefreshAfterApply.call(dialog, workflow, []);
  setTimeout(() => finish(), 0);
  await finished;
  assert.deepEqual(calls, ['catalog']);
});

test('Apply reuses the content-preserving workflow analysis path', () => {
  const applyPendingResolutionList = extractMethod(
    queueMethodsSource,
    'applyPendingResolutionList'
  );

  assert.match(
    applyPendingResolutionList,
    /loadWorkflowData\?\.\(data\.workflow,\s*\{\s*preserveContent: true/
  );
  assert.doesNotMatch(applyPendingResolutionList, /applyOptimisticAnalysisData\(/);
  assert.doesNotMatch(applyPendingResolutionList, /refreshAnalysisInBackground\(/);
});

test('Apply keeps the workflow slot key when resolved path identity changes', () => {
  const doesResolvedModelMatchAlias = eval(
    `(${extractMethod(queueMethodsSource, 'doesResolvedModelMatchAlias')})`
  );
  const applyResolvedSelectionAliasesToAnalysisData = eval(
    `(${extractMethod(queueMethodsSource, 'applyResolvedSelectionAliasesToAnalysisData')})`
  );
  const data = {
    resolved_models: [{
      node_id: 7,
      widget_index: 0,
      category: 'loras',
      missing_key: 'backend-path-key',
      original_path: 'different/backend/path.safetensors',
    }],
  };
  const dialog = {
    appliedResolvedSelectionAliases: new Map([
      ['stable-slot-key', {
        category: 'loras',
        refs: [{ node_id: 7, widget_index: 0 }],
      }],
    ]),
    doesResolvedModelMatchAlias,
  };

  applyResolvedSelectionAliasesToAnalysisData.call(dialog, data);

  assert.equal(data.resolved_models[0].missing_key, 'stable-slot-key');
  assert.equal(dialog.appliedResolvedSelectionAliases.size, 0);
});

test('background Loaded Models refresh keeps the current view until new data is ready', async () => {
  const loadLoadedModels = eval(`(${extractMethod(tabsLoadedMethodsSource, 'loadLoadedModels')})`);
  const workflow = {
    nodes: [{
      id: 7,
      type: 'LoraLoader',
      widgets_values: ['model.safetensors', 0.75],
    }],
  };
  const contentElement = {
    innerHTML: '<div>Existing loaded models</div>',
    scrollTop: 48,
  };
  let resolveFetch;
  const fetchPromise = new Promise(resolve => {
    resolveFetch = resolve;
  });
  let progressRenderCount = 0;
  let progressPollCount = 0;
  const dialog = {
    activeTab: 'loaded',
    contentElement,
    cachedLoadedModelsSignature: 'old-signature',
    cachedLoadedModelsData: { loaded_models: [], total: 0 },
    syncWorkflowScopedQueue() {},
    getWorkflowSignature: () => 'new-signature',
    renderLoadedModelsProgress() {
      progressRenderCount += 1;
      return '<div>Progress</div>';
    },
    pollLoadedModelsProgress() {
      progressPollCount += 1;
      return Promise.resolve();
    },
    fetchJson: () => fetchPromise,
    saveLoadedModelsCacheForActiveWorkflow() {},
    displayLoadedModels(container, data) {
      container.innerHTML = `<div>${data.loaded_models[0].strength}</div>`;
      container.scrollTop = 0;
    },
  };

  const refreshPromise = loadLoadedModels.call(
    dialog,
    workflow,
    { preserveContent: true }
  );
  await Promise.resolve();

  assert.equal(contentElement.innerHTML, '<div>Existing loaded models</div>');
  assert.equal(progressRenderCount, 0);
  assert.equal(progressPollCount, 0);

  resolveFetch({
    loaded_models: [{ name: 'model.safetensors', strength: 0.75 }],
    total: 1,
  });
  await refreshPromise;

  assert.equal(contentElement.innerHTML, '<div>0.75</div>');
  assert.equal(contentElement.scrollTop, 48);
});

test('Loaded Models progress patches the stable progress container', () => {
  const patchLoadedModelsProgress = extractMethod(
    renderFormatMethodsSource,
    'patchLoadedModelsProgress'
  );
  const pollLoadedModelsProgress = extractMethod(
    renderFormatMethodsSource,
    'pollLoadedModelsProgress'
  );
  const loadLoadedModels = extractMethod(tabsLoadedMethodsSource, 'loadLoadedModels');
  const patchAnalysisProgress = extractMethod(renderFormatMethodsSource, 'patchAnalysisProgress');
  const pollAnalysisProgress = extractMethod(renderFormatMethodsSource, 'pollAnalysisProgress');

  assert.match(patchLoadedModelsProgress, /mr-download-section/);
  assert.match(patchLoadedModelsProgress, /mr-progress-fill/);
  assert.match(patchLoadedModelsProgress, /currentInfo/);
  assert.match(pollLoadedModelsProgress, /patchLoadedModelsProgress\(/);
  assert.doesNotMatch(pollLoadedModelsProgress, /contentElement\.innerHTML\s*=/);
  assert.match(loadLoadedModels, /patchLoadedModelsProgress\(/);
  assert.match(patchAnalysisProgress, /patchLoadedModelsProgress\(/);
  assert.match(pollAnalysisProgress, /patchAnalysisProgress\(/);
  assert.doesNotMatch(pollAnalysisProgress, /contentElement\.innerHTML\s*=/);
});

test('Power Lora Loader strength updates only its Loaded Models chip and cache', () => {
  const updateLoadedModelStrengthsFromNode = eval(
    `(${extractMethod(tabsLoadedMethodsSource, 'updateLoadedModelStrengthsFromNode')})`
  );
  const normalizeLoadedModelIdentity = eval(
    `(${extractMethod(tabsLoadedMethodsSource, 'normalizeLoadedModelIdentity')})`
  );
  const getLoadedModelDomKey = eval(
    `(${extractMethod(tabsLoadedMethodsSource, 'getLoadedModelDomKey')})`
  );
  const strengthElement = { textContent: '1.00' };
  const chip = {
    dataset: { mlLoadedModelKey: 'model-key' },
    querySelector: selector => (
      selector === '.mr-model-chip-strength' ? strengthElement : null
    ),
  };
  const contentElement = {
    querySelectorAll: selector => (
      selector === '[data-ml-loaded-model-key]' ? [chip] : []
    ),
  };
  const loadedModel = {
    node_id: 91,
    widget_index: 0,
    nested_key: 'lora',
    category: 'loras',
    original_path: 'styles/existing.safetensors',
    strength: 1,
  };
  const calls = [];
  const dialog = {
    activeTab: 'loaded',
    contentElement,
    cachedLoadedModelsData: {
      loaded_models: [loadedModel],
      total: 1,
    },
    cachedLoadedModelsSignature: 'old-signature',
    activeWorkflowSignature: 'old-signature',
    normalizeLoadedModelIdentity,
    getLoadedModelDomKey,
    getMissingModelKey: () => 'model-key',
    updateLoadedModelCopyValues: (_container, models) => {
      calls.push(['copy-values', models[0].strength]);
    },
    getCurrentWorkflow: () => ({ nodes: [{ id: 91 }] }),
    getWorkflowSignature: () => 'strength-signature',
    saveLoadedModelsCacheForActiveWorkflow: () => calls.push(['save-cache']),
    displayLoadedModels: () => calls.push(['full-render']),
  };
  const node = {
    id: 91,
    comfyClass: 'Power Lora Loader (rgthree)',
    widgets: [{
      name: 'lora_1',
      value: {
        on: true,
        lora: 'styles/existing.safetensors',
        strength: 0.5,
      },
    }],
  };

  const updated = updateLoadedModelStrengthsFromNode.call(dialog, node);

  assert.equal(updated, true);
  assert.equal(loadedModel.strength, 0.5);
  assert.equal(strengthElement.textContent, '0.50');
  assert.equal(dialog.cachedLoadedModelsSignature, 'strength-signature');
  assert.equal(dialog.activeWorkflowSignature, 'strength-signature');
  assert.deepEqual(calls, [
    ['copy-values', 0.5],
    ['save-cache'],
  ]);
});

test('changed workflow model keeps the selected row and batch checkbox for the same loader slot', () => {
  const {
    encodeMissingModelKeyPart,
    getMissingModelIdentityPart,
    getMissingModelKey,
    getMissingModelWorkflowSlotKeys,
    findMissingModelReplacement,
    resolvePreservedMissingModelKey,
    remapMissingModelKeys,
  } = workflowIdentityMethods;
  const dialog = {
    encodeMissingModelKeyPart,
    getMissingModelIdentityPart,
    getMissingModelKey,
    getMissingModelWorkflowSlotKeys,
    findMissingModelReplacement,
    resolvePreservedMissingModelKey,
    remapMissingModelKeys,
  };
  const oldModels = [
    { node_id: 73, widget_index: 0, category: 'loras', original_path: 'first.safetensors' },
    { node_id: 74, widget_index: 0, category: 'loras', original_path: 'old-model.safetensors' },
    { node_id: 75, widget_index: 0, category: 'loras', original_path: 'last.safetensors' },
  ];
  const newModels = [
    { node_id: 73, widget_index: 0, category: 'loras', original_path: 'first.safetensors' },
    { node_id: 74, widget_index: 0, category: 'loras', original_path: 'new-model.safetensors' },
    { node_id: 75, widget_index: 0, category: 'loras', original_path: 'last.safetensors' },
  ];
  const oldSelectedKey = getMissingModelKey.call(dialog, oldModels[1]);
  const unchangedBatchKey = getMissingModelKey.call(dialog, oldModels[2]);
  const newSelectedKey = getMissingModelKey.call(dialog, newModels[1]);

  assert.equal(
    resolvePreservedMissingModelKey.call(dialog, newModels, oldModels, oldSelectedKey),
    newSelectedKey
  );
  assert.deepEqual(
    remapMissingModelKeys.call(
      dialog,
      newModels,
      oldModels,
      new Set([oldSelectedKey, unchangedBatchKey])
    ),
    new Set([newSelectedKey, unchangedBatchKey])
  );
});

test('background Missing Models refresh keeps the current view until new data is ready', async () => {
  const loadWorkflowData = eval(`(${extractMethod(lifecycleGraphMethodsSource, 'loadWorkflowData')})`);
  const workflow = {
    nodes: [{
      id: 7,
      type: 'LoraLoader',
      widgets_values: ['model.safetensors', 0.75],
    }],
  };
  const contentElement = {
    innerHTML: '<div>Existing missing models</div>',
    scrollTop: 36,
  };
  let resolveFetch;
  const fetchPromise = new Promise(resolve => {
    resolveFetch = resolve;
  });
  let progressRenderCount = 0;
  let progressPollCount = 0;
  let displayOptions = null;
  const dialog = {
    activeTab: 'missing',
    contentElement,
    cachedWorkflowSignature: 'old-signature',
    cachedAnalysisData: { missing_models: [], resolved_models: [] },
    syncWorkflowScopedQueue() {},
    getMissingWorkflowSignature: () => 'new-signature',
    getWorkflowAnalysisRequest: () => ({
      analysisId: 'shared-analysis',
      promise: fetchPromise,
    }),
    workflowHasNodes: () => true,
    renderAnalysisProgress() {
      progressRenderCount += 1;
      return '<div>Progress</div>';
    },
    pollAnalysisProgress() {
      progressPollCount += 1;
      return Promise.resolve();
    },
    fetchJson: () => fetchPromise,
    applyResolvedSelectionAliasesToAnalysisData() {},
    saveAnalysisCacheForActiveWorkflow() {},
    ensureDownloadDirectoriesLoaded: async () => {},
    displayMissingModels(container, data, options) {
      displayOptions = options;
      container.innerHTML = `<div>${data.resolved_models[0].strength}</div>`;
      container.scrollTop = 0;
    },
    applyPendingWorkflowModelSelection() {},
    reconnectActiveDownloads() {},
  };

  const refreshPromise = loadWorkflowData.call(
    dialog,
    workflow,
    { preserveContent: true }
  );
  await Promise.resolve();

  assert.equal(contentElement.innerHTML, '<div>Existing missing models</div>');
  assert.equal(progressRenderCount, 0);
  assert.equal(progressPollCount, 0);

  resolveFetch({
    missing_models: [],
    resolved_models: [{ name: 'model.safetensors', strength: 0.75 }],
    total_missing: 0,
    total_resolved: 1,
  });
  await refreshPromise;

  assert.equal(contentElement.innerHTML, '<div>0.75</div>');
  assert.equal(contentElement.scrollTop, 36);
  assert.deepEqual(displayOptions, { preserveBrowser: true });
});

test('concurrent workflow analysis consumers share one in-flight request', async () => {
  const getWorkflowAnalysisRequest = eval(
    `(${extractMethod(workflowStateMethodsSource, 'getWorkflowAnalysisRequest')})`
  );
  const workflow = { nodes: [{ id: 1, type: 'CheckpointLoaderSimple', widgets_values: ['model.safetensors'] }] };
  let resolveFirst;
  const pending = new Promise(resolve => {
    resolveFirst = resolve;
  });
  const calls = [];
  const responses = [pending, Promise.resolve({})];
  const dialog = {
    getMissingWorkflowSignature: () => 'model-signature',
    getActiveWorkflowRouteKey: () => 'workflow-a',
    fetchJson: (...args) => {
      calls.push(args);
      return responses.shift();
    },
  };

  const first = getWorkflowAnalysisRequest.call(dialog, workflow);
  const second = getWorkflowAnalysisRequest.call(dialog, workflow);

  assert.equal(first, second);
  assert.equal(calls.length, 1);
  assert.match(calls[0][0], /\/model_resolver\/analyze$/);

  resolveFirst({ missing_models: [] });
  await first.promise;
  await Promise.resolve();

  const next = getWorkflowAnalysisRequest.call(dialog, workflow);
  assert.notEqual(next, first);
  assert.equal(calls.length, 2);
});

test('content-preserving Missing Models refresh patches the browser instead of clearing it', () => {
  const patchMissingModelsBrowserElement = extractMethod(
    missingBrowserMethodsSource,
    'patchMissingModelsBrowserElement'
  );
  const patchMissingModelRowElement = extractMethod(
    missingBrowserMethodsSource,
    'patchMissingModelRowElement'
  );
  const reconcileMissingModelRows = extractMethod(
    missingBrowserMethodsSource,
    'reconcileMissingModelRows'
  );
  const setupMissingModelsVirtualizer = extractMethod(
    missingBrowserMethodsSource,
    'setupMissingModelsVirtualizer'
  );
  const destroyMissingModelsVirtualizer = extractMethod(
    missingBrowserMethodsSource,
    'destroyMissingModelsVirtualizer'
  );
  const displayMissingModels = extractMethod(
    missingBrowserMethodsSource,
    'displayMissingModels'
  );

  assert.match(
    patchMissingModelsBrowserElement,
    /reconcileMissingModelRows\(/
  );
  assert.match(
    reconcileMissingModelRows,
    /patchMissingModelRowElement\(currentRow, nextRow\)/
  );
  assert.match(
    patchMissingModelRowElement,
    /currentRow\.innerHTML = nextRow\.innerHTML/
  );
  assert.match(
    patchMissingModelRowElement,
    /_wiredMissingModelRows\?\.delete\?\./
  );
  assert.match(
    setupMissingModelsVirtualizer,
    /reconcileMissingModelRows\(rowsHost, nextRows\)/
  );
  assert.doesNotMatch(
    setupMissingModelsVirtualizer,
    /rowsHost\.innerHTML/
  );
  assert.match(
    destroyMissingModelsVirtualizer,
    /removeEventListener\('scroll', state\.onScroll\)/
  );
  assert.match(
    destroyMissingModelsVirtualizer,
    /resizeObserver\?\.disconnect\?\./
  );
  assert.match(
    destroyMissingModelsVirtualizer,
    /_mrMissingVirtualState = null/
  );
  assert.doesNotMatch(
    patchMissingModelsBrowserElement,
    /currentBrowser\.replaceWith\(nextBrowser\)/
  );
  assert.match(
    patchMissingModelsBrowserElement,
    /currentRowsHost === currentList \? currentList : currentRowsHost/
  );
  assert.match(
    patchMissingModelsBrowserElement,
    /currentDetail\.innerHTML = nextDetail\.innerHTML/
  );
  assert.doesNotMatch(
    patchMissingModelsBrowserElement,
    /currentDetail\.replaceWith\(nextDetail\)/
  );
  assert.match(
    displayMissingModels,
    /options\.preserveBrowser[\s\S]*?patchMissingModelsBrowserElement/
  );
  assert.match(
    displayMissingModels,
    /if \(!browserPatched\) \{\s*this\.destroyMissingModelsVirtualizer\(container\);\s*container\.innerHTML = browserHtml;/
  );
});

test('Missing Models browser reuses rows by key, slot, and index while removing stale rows', () => {
  const patchMissingModelsBrowserElement = eval(
    `(${extractMethod(missingBrowserMethodsSource, 'patchMissingModelsBrowserElement')})`
  );
  const patchMissingModelRowElement = eval(
    `(${extractMethod(missingBrowserMethodsSource, 'patchMissingModelRowElement')})`
  );
  const reconcileMissingModelRows = eval(
    `(${extractMethod(missingBrowserMethodsSource, 'reconcileMissingModelRows')})`
  );
  const window = new Window();
  const previousDocument = globalThis.document;
  const container = window.document.createElement('div');
  globalThis.document = window.document;

  try {
    container.innerHTML = `
    <div class="mr-missing-browser">
      <div class="mr-missing-list">
        <div class="mr-missing-list-virtual-scroll">
          <div class="mr-missing-list-virtual-rows">
            <div class="mr-missing-list-row" data-missing-key="key-a" data-missing-index="0" data-missing-slot-keys="slot-a">old-a</div>
            <div class="mr-missing-list-row" data-missing-key="key-b" data-missing-index="1" data-missing-slot-keys="slot-b">old-b</div>
            <div class="mr-missing-list-row" data-missing-key="key-c" data-missing-index="2" data-missing-slot-keys="slot-c">old-c</div>
            <div class="mr-missing-list-row" data-missing-key="stale" data-missing-index="3" data-missing-slot-keys="slot-stale">stale</div>
          </div>
        </div>
      </div>
    </div>
    `;
    const keyRow = container.querySelector('[data-missing-key="key-a"]');
    const slotRow = container.querySelector('[data-missing-key="key-b"]');
    const indexRow = container.querySelector('[data-missing-key="key-c"]');
    const dialog = {
      _wiredMissingModelRows: new Set(),
      patchMissingModelRowElement,
      reconcileMissingModelRows,
    };

    const patched = patchMissingModelsBrowserElement.call(dialog, container, `
    <div class="mr-missing-browser">
      <div class="mr-missing-list">
        <div class="mr-missing-list-virtual-scroll">
          <div class="mr-missing-list-virtual-rows">
            <div class="mr-missing-list-row" data-missing-key="key-a" data-missing-index="10" data-missing-slot-keys="slot-new-a">new-a</div>
            <div class="mr-missing-list-row" data-missing-key="new-b" data-missing-index="11" data-missing-slot-keys="slot-b">new-b</div>
            <div class="mr-missing-list-row" data-missing-key="new-c" data-missing-index="2" data-missing-slot-keys="slot-new-c">new-c</div>
            <div class="mr-missing-list-row" data-missing-key="new-d" data-missing-index="12" data-missing-slot-keys="slot-new-d">new-d</div>
          </div>
        </div>
      </div>
    </div>
    `);

    assert.equal(patched, true);
    const rows = Array.from(container.querySelectorAll('.mr-missing-list-row'));
    assert.deepEqual(
      rows.map(row => row.dataset.missingKey),
      ['key-a', 'new-b', 'new-c', 'new-d']
    );
    assert.equal(container.querySelector('[data-missing-key="key-a"]'), keyRow);
    assert.equal(container.querySelector('[data-missing-key="new-b"]'), slotRow);
    assert.equal(container.querySelector('[data-missing-key="new-c"]'), indexRow);
    assert.equal(keyRow.textContent, 'new-a');
    assert.equal(slotRow.textContent, 'new-b');
    assert.equal(indexRow.textContent, 'new-c');
  } finally {
    globalThis.document = previousDocument;
  }
});

test('cached Missing Models refresh preserves browser geometry after linking a local match', () => {
  const refreshMissingModelsBrowserFromCache = eval(
    `(${extractMethod(missingBrowserMethodsSource, 'refreshMissingModelsBrowserFromCache')})`
  );
  const contentElement = {};
  const cachedAnalysisData = { missing_models: [{ filename: 'model.safetensors' }] };
  let renderCall = null;
  const dialog = {
    activeTab: 'missing',
    contentElement,
    cachedAnalysisData,
    displayMissingModels(...args) {
      renderCall = args;
    },
  };

  refreshMissingModelsBrowserFromCache.call(dialog);

  assert.deepEqual(renderCall, [
    contentElement,
    cachedAnalysisData,
    { preserveBrowser: true },
  ]);
});

test('workflow analysis and loaded model caches stay independent and cloned', () => {
  const saveWorkflowModelCache = eval(
    `(${extractMethod(workflowStateMethodsSource, 'saveWorkflowModelCache')})`
  );
  const restoreWorkflowModelCache = eval(
    `(${extractMethod(workflowStateMethodsSource, 'restoreWorkflowModelCache')})`
  );
  const saveAnalysisCacheForActiveWorkflow = eval(
    `(${extractMethod(workflowStateMethodsSource, 'saveAnalysisCacheForActiveWorkflow')})`
  );
  const restoreAnalysisCacheForActiveWorkflow = eval(
    `(${extractMethod(workflowStateMethodsSource, 'restoreAnalysisCacheForActiveWorkflow')})`
  );
  const saveLoadedModelsCacheForActiveWorkflow = eval(
    `(${extractMethod(workflowStateMethodsSource, 'saveLoadedModelsCacheForActiveWorkflow')})`
  );
  const restoreLoadedModelsCacheForActiveWorkflow = eval(
    `(${extractMethod(workflowStateMethodsSource, 'restoreLoadedModelsCacheForActiveWorkflow')})`
  );
  const dialog = {
    workflowKey: 'workflow-a\nsignature-a',
    workflowAnalysisCaches: new Map(),
    workflowLoadedModelCaches: new Map(),
    cachedWorkflowSignature: 'analysis-signature',
    cachedAnalysisData: { missing_models: [{ filename: 'missing.safetensors' }] },
    cachedLoadedModelsSignature: 'loaded-signature',
    cachedLoadedModelsData: { loaded_models: [{ filename: 'loaded.safetensors' }] },
    getWorkflowScopedQueueKey() {
      return this.workflowKey;
    },
    saveWorkflowModelCache,
    restoreWorkflowModelCache,
    cloneAnalysisData(data) {
      return JSON.parse(JSON.stringify(data));
    },
  };

  saveAnalysisCacheForActiveWorkflow.call(dialog);
  saveLoadedModelsCacheForActiveWorkflow.call(dialog);

  dialog.cachedAnalysisData.missing_models[0].filename = 'changed-analysis.safetensors';
  dialog.cachedLoadedModelsData.loaded_models[0].filename = 'changed-loaded.safetensors';
  assert.equal(
    dialog.workflowAnalysisCaches.get(dialog.workflowKey).data.missing_models[0].filename,
    'missing.safetensors'
  );
  assert.equal(
    dialog.workflowLoadedModelCaches.get(dialog.workflowKey).data.loaded_models[0].filename,
    'loaded.safetensors'
  );

  dialog.cachedWorkflowSignature = null;
  dialog.cachedAnalysisData = null;
  dialog.cachedLoadedModelsSignature = null;
  dialog.cachedLoadedModelsData = null;
  restoreAnalysisCacheForActiveWorkflow.call(dialog);
  restoreLoadedModelsCacheForActiveWorkflow.call(dialog);

  assert.equal(dialog.cachedWorkflowSignature, 'analysis-signature');
  assert.equal(dialog.cachedLoadedModelsSignature, 'loaded-signature');
  assert.equal(dialog.cachedAnalysisData.missing_models[0].filename, 'missing.safetensors');
  assert.equal(dialog.cachedLoadedModelsData.loaded_models[0].filename, 'loaded.safetensors');

  dialog.cachedAnalysisData.missing_models.push({ filename: 'local-only.safetensors' });
  assert.equal(dialog.workflowAnalysisCaches.get(dialog.workflowKey).data.missing_models.length, 1);
});

test('Missing Models filter toggles persist state and rerender once per change', () => {
  const bindMissingFilterToggle = eval(
    `(${extractMethod(missingBrowserMethodsSource, 'bindMissingFilterToggle')})`
  );
  const wireMissingModelsBrowser = eval(
    `(${extractMethod(missingBrowserMethodsSource, 'wireMissingModelsBrowser')})`
  );
  const window = new Window();
  const previousDocument = globalThis.document;
  const previousElement = globalThis.Element;
  const previousHTMLElement = globalThis.HTMLElement;
  const previousLocalStorage = globalThis.localStorage;
  const localStorageValues = new Map();
  const container = window.document.createElement('div');
  container.innerHTML = `
    <div class="mr-missing-browser">
      <input id="mr-show-resolved-models" type="checkbox">
      <input id="mr-show-auto-download-models" type="checkbox">
      <input id="mr-show-inactive-models" type="checkbox">
    </div>
  `;
  const renderOptions = [];
  const dialog = {
    showResolvedModels: false,
    showAutoDownloadModels: true,
    showInactiveModels: false,
    showResolvedModelsStorageKey: 'test_show_resolved_models',
    showAutoDownloadModelsStorageKey: 'test_show_auto_download_models',
    showInactiveModelsStorageKey: 'test_show_inactive_models',
    missingModelsTypeFilterMenuOpen: false,
    bindMissingFilterToggle,
    wireMissingBrowserSplitter() {},
    wireVisibleMissingModelRows() {},
    setupMissingModelsVirtualizer() {},
    displayMissingModels(_container, _data, options) {
      renderOptions.push(options);
    },
  };

  globalThis.document = window.document;
  globalThis.Element = window.Element;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.localStorage = {
    getItem(key) {
      return localStorageValues.has(key) ? localStorageValues.get(key) : null;
    },
    setItem(key, value) {
      localStorageValues.set(key, String(value));
    },
    removeItem(key) {
      localStorageValues.delete(key);
    },
  };

  try {
    wireMissingModelsBrowser.call(dialog, container, {}, []);
    wireMissingModelsBrowser.call(dialog, container, {}, []);

    const resolvedToggle = container.querySelector('#mr-show-resolved-models');
    const autoDownloadToggle = container.querySelector('#mr-show-auto-download-models');
    const inactiveToggle = container.querySelector('#mr-show-inactive-models');
    resolvedToggle.checked = true;
    autoDownloadToggle.checked = false;
    inactiveToggle.checked = true;
    resolvedToggle.dispatchEvent(new window.Event('change'));
    autoDownloadToggle.dispatchEvent(new window.Event('change'));
    inactiveToggle.dispatchEvent(new window.Event('change'));

    assert.equal(dialog.showResolvedModels, true);
    assert.equal(dialog.showAutoDownloadModels, false);
    assert.equal(dialog.showInactiveModels, true);
    assert.equal(safeStorage.getItem(dialog.showResolvedModelsStorageKey), '1');
    assert.equal(safeStorage.getItem(dialog.showAutoDownloadModelsStorageKey), '0');
    assert.equal(safeStorage.getItem(dialog.showInactiveModelsStorageKey), '1');
    assert.deepEqual(renderOptions, [
      { preserveBrowser: true },
      { preserveBrowser: true },
      { preserveBrowser: true },
    ]);
  } finally {
    safeStorage.removeItem(dialog.showResolvedModelsStorageKey);
    safeStorage.removeItem(dialog.showAutoDownloadModelsStorageKey);
    safeStorage.removeItem(dialog.showInactiveModelsStorageKey);
    globalThis.document = previousDocument;
    globalThis.Element = previousElement;
    globalThis.HTMLElement = previousHTMLElement;
    globalThis.localStorage = previousLocalStorage;
  }
});

test('node widget changes request a content-preserving Missing Models refresh', async () => {
  const log = { debug() {} };
  const refreshForActiveWorkflowChange = eval(
    `(${extractMethod(workflowStateMethodsSource, 'refreshForActiveWorkflowChange')})`
  );
  const workflow = {
    nodes: [{
      id: 7,
      type: 'LoraLoader',
      widgets_values: ['model.safetensors', 0.75],
    }],
  };
  let loadArguments = null;
  let preserveSearchCacheAtSync = false;
  const dialog = {
    _workflowRefreshGeneration: 1,
    activeWorkflowRouteKey: 'workflow-a',
    activeWorkflowSignature: 'old-signature',
    activeMissingWorkflowSignature: 'old-missing-signature',
    activeTab: 'missing',
    contentElement: { style: {} },
    isVisible: () => true,
    getActiveWorkflowRouteKey: () => 'workflow-a',
    getCurrentWorkflow: () => workflow,
    getWorkflowSignature: () => 'new-signature',
    getMissingWorkflowSignature: () => 'new-missing-signature',
    syncWorkflowScopedQueue() {
      preserveSearchCacheAtSync = this.preserveSearchCacheAcrossNextWorkflowSync;
    },
    async loadWorkflowData(...args) {
      loadArguments = args;
    },
  };

  await refreshForActiveWorkflowChange.call(dialog, {
    reason: 'node-widget-change',
    expectedRoute: 'workflow-a',
    previousSignature: 'old-signature',
    attempt: 8,
    generation: 1,
    candidateRoute: 'workflow-a',
    candidateSignature: 'new-signature',
  });

  assert.equal(loadArguments[0], workflow);
  assert.deepEqual(loadArguments[1], { preserveContent: true });
  assert.equal(preserveSearchCacheAtSync, true);
});

test('node widget refresh retries while ComfyUI still serializes the previous workflow', async () => {
  const log = { debug() {} };
  const refreshForActiveWorkflowChange = eval(
    `(${extractMethod(workflowStateMethodsSource, 'refreshForActiveWorkflowChange')})`
  );
  const workflow = { version: 'old' };
  let loadArguments = null;
  let retryCallback = null;
  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = callback => {
    retryCallback = callback;
    return 1;
  };

  const dialog = {
    _workflowRefreshGeneration: 1,
    activeWorkflowRouteKey: 'workflow-a',
    activeWorkflowSignature: 'old-signature',
    activeMissingWorkflowSignature: 'old-missing-signature',
    activeTab: 'missing',
    contentElement: { style: {} },
    isVisible: () => true,
    getActiveWorkflowRouteKey: () => 'workflow-a',
    getCurrentWorkflow: () => workflow,
    getWorkflowSignature: currentWorkflow => `${currentWorkflow.version}-signature`,
    getMissingWorkflowSignature: currentWorkflow => `${currentWorkflow.version}-missing-signature`,
    refreshForActiveWorkflowChange,
    syncWorkflowScopedQueue() {},
    async loadWorkflowData(...args) {
      loadArguments = args;
    },
  };

  try {
    await refreshForActiveWorkflowChange.call(dialog, {
      reason: 'node-widget-change',
      expectedRoute: 'workflow-a',
      previousSignature: 'old-signature',
      attempt: 0,
      generation: 1,
      candidateRoute: 'workflow-a',
      candidateSignature: 'new-signature',
    });

    assert.equal(loadArguments, null);
    assert.equal(typeof retryCallback, 'function');

    workflow.version = 'new';
    retryCallback();
    await Promise.resolve();

    assert.equal(loadArguments[0], workflow);
    assert.deepEqual(loadArguments[1], { preserveContent: true });
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }
});

test('node context analysis waits for a visible workflow refresh to finish', async () => {
  const refreshNodeContextMenuAnalysis = eval(
    `(${extractMethod(modelResolverSource, 'refreshNodeContextMenuAnalysis')})`
  );
  const calls = [];
  const dialog = {
    isVisible: () => true,
    _workflowRefreshRetryTimer: 1,
  };
  const resolver = {
    dialog,
    scheduleNodeContextMenuAnalysis: delay => calls.push(delay),
  };

  const result = await refreshNodeContextMenuAnalysis.call(resolver);

  assert.equal(result, null);
  assert.deepEqual(calls, [180]);
});

test('strength-only widget changes synchronize workflow state without refreshing Missing Models', async () => {
  const log = { debug() {} };
  const refreshForActiveWorkflowChange = eval(
    `(${extractMethod(workflowStateMethodsSource, 'refreshForActiveWorkflowChange')})`
  );
  const workflow = {
    nodes: [{
      id: 7,
      type: 'LoraLoader',
      widgets_values: ['model.safetensors', 1.25],
    }],
  };
  let syncCount = 0;
  let loadCount = 0;
  const dialog = {
    _workflowRefreshGeneration: 1,
    activeWorkflowRouteKey: 'workflow-a',
    activeWorkflowSignature: 'old-full-signature',
    activeMissingWorkflowSignature: 'same-missing-signature',
    activeTab: 'missing',
    contentElement: { style: {} },
    isVisible: () => true,
    getActiveWorkflowRouteKey: () => 'workflow-a',
    getCurrentWorkflow: () => workflow,
    getWorkflowSignature: () => 'new-full-signature',
    getMissingWorkflowSignature: () => 'same-missing-signature',
    syncWorkflowScopedQueue() {
      syncCount += 1;
    },
    async loadWorkflowData() {
      loadCount += 1;
    },
  };

  await refreshForActiveWorkflowChange.call(dialog, {
    reason: 'node-widget-change',
    expectedRoute: 'workflow-a',
    previousSignature: 'old-full-signature',
    attempt: 8,
    generation: 1,
    candidateRoute: 'workflow-a',
    candidateSignature: 'new-full-signature',
  });

  assert.equal(syncCount, 1);
  assert.equal(loadCount, 0);
  assert.equal(dialog.preserveSearchCacheAcrossNextWorkflowSync, true);
});

test('workflow synchronization carries searched results across a strength-only signature change', () => {
  const syncWorkflowScopedQueue = eval(
    `(${extractMethod(workflowStateMethodsSource, 'syncWorkflowScopedQueue')})`
  );
  const workflow = {
    nodes: [{
      id: 7,
      type: 'LoraLoader',
      widgets_values: ['missing.safetensors', 0.75],
    }],
  };
  const searchedState = {
    selectedSource: 'civitai',
    results: {
      civitai: { name: 'Found model' },
    },
  };
  const dialog = {
    preserveSearchCacheAcrossNextWorkflowSync: true,
    activeWorkflowRouteKey: 'workflow-a',
    activeWorkflowSignature: 'old-signature',
    activeMissingWorkflowSignature: 'same-missing-signature',
    searchResultCache: new Map([['loras:missing.safetensors', searchedState]]),
    backgroundSearchJobs: new Map(),
    getCurrentWorkflow: () => workflow,
    getActiveWorkflowRouteKey: () => 'workflow-a',
    getWorkflowSignature: () => 'new-signature',
    getMissingWorkflowSignature: () => 'same-missing-signature',
    getWorkflowScopedQueueKey(
      route = dialog.activeWorkflowRouteKey,
      signature = dialog.activeMissingWorkflowSignature || dialog.activeWorkflowSignature
    ) {
      return `${route}\n${signature}`;
    },
    cloneSearchResultCache(cache) {
      return new Map(cache);
    },
    savePendingQueueForActiveWorkflow() {},
    saveAnalysisCacheForActiveWorkflow() {},
    saveLoadedModelsCacheForActiveWorkflow() {},
    saveSearchCacheForActiveWorkflow() {},
    saveDownloadTargetSelectionsForActiveWorkflow() {},
    clearWorkflowScopedState() {
      this.searchResultCache.clear();
    },
    restorePendingQueueForActiveWorkflow() {},
    restoreAnalysisCacheForActiveWorkflow() {},
    restoreLoadedModelsCacheForActiveWorkflow() {},
    restoreSearchCacheForActiveWorkflow() {
      this.searchResultCache = new Map();
    },
    restoreDownloadTargetSelectionsForActiveWorkflow() {},
  };

  syncWorkflowScopedQueue.call(dialog, workflow);

  assert.equal(dialog.activeWorkflowSignature, 'new-signature');
  assert.equal(dialog.activeMissingWorkflowSignature, 'same-missing-signature');
  assert.equal(
    dialog.searchResultCache.get('loras:missing.safetensors'),
    searchedState
  );
  assert.equal(dialog.preserveSearchCacheAcrossNextWorkflowSync, false);
});

test('pending node context model resolves against the current workflow analysis before action', async () => {
  const resolveNodeContextMenuModel = eval(`(${extractMethod(modelResolverSource, 'resolveNodeContextMenuModel')})`);
  const pendingModel = {
    node_id: 7,
    widget_index: 0,
    original_path: 'new-model.safetensors',
    is_top_level: true,
    resolution_pending: true,
  };
  const resolvedModel = {
    ...pendingModel,
    full_path: 'E:\\models\\new-model.safetensors',
    exists: true,
    resolution_pending: false,
  };
  const resolver = {
    ensureCurrentNodeContextAnalysis: async () => ({
      resolved_models: [resolvedModel],
    }),
  };

  assert.equal(
    await resolveNodeContextMenuModel.call(resolver, pendingModel),
    resolvedModel
  );
  assert.equal(isExistingResolvedModel(resolvedModel), true);
});

test('loaded model context menu locates its exact workflow node and subgraph', () => {
  const getLoadedModelContext = eval(`(${extractMethod(tabsLoadedMethodsSource, 'getLoadedModelContext')})`);
  const handleContextMenuAction = eval(`(${extractMethod(modelInfoMethodsSource, 'handleContextMenuAction')})`);
  const calls = [];
  const model = getLoadedModelContext.call({}, {
    node_id: 19,
    subgraph_id: 'subgraph-a',
    is_top_level: false,
  });
  const dialog = {
    _contextMenuModel: model,
    hideContextMenu() {},
    getMissingLocateTarget(value) {
      return {
        nodeId: value.node_id,
        subgraphId: value.subgraph_id,
        isTopLevel: value.is_top_level,
      };
    },
    locateNodeInGraph(nodeId, options) {
      calls.push({ nodeId, options });
    },
  };

  handleContextMenuAction.call(dialog, 'locateNode');

  assert.equal(model.context_scope, 'loaded_model');
  assert.deepEqual(calls, [{
    nodeId: 19,
    options: {
      subgraphId: 'subgraph-a',
      isTopLevel: false,
    },
  }]);
  assert.match(resolverDialogSource, /data-menu-action": "locateNode"/);
  assert.match(resolverDialogSource, /textContent: "Locate Node"/);
});

test('download result context menu offers subfolder suggestions only for CivitAI and CivArchive', () => {
  const canSuggestDownloadSubfolderFromContextMenu = eval(`(${extractMethod(downloadTargetMethodsSource, 'canSuggestDownloadSubfolderFromContextMenu')})`);

  assert.equal(canSuggestDownloadSubfolderFromContextMenu({
    context_scope: 'download_table',
    source: 'civitai',
  }), true);
  assert.equal(canSuggestDownloadSubfolderFromContextMenu({
    context_scope: 'download_table',
    details_source: 'civarchive',
  }), true);
  assert.equal(canSuggestDownloadSubfolderFromContextMenu({
    context_scope: 'download_table',
    source: 'huggingface',
  }), false);
  assert.equal(canSuggestDownloadSubfolderFromContextMenu({
    context_scope: 'local_model',
    source: 'civitai',
  }), false);
  assert.match(resolverDialogSource, /data-menu-action": "suggestSubfolder"/);
  assert.match(resolverDialogSource, /textContent: "Suggest Subfolder"/);
});

test('download result context menu reuses the existing forced subfolder suggestion', async () => {
  const getContextMenuDownloadMissing = eval(`(${extractMethod(downloadTargetMethodsSource, 'getContextMenuDownloadMissing')})`);
  const suggestDownloadSubfolderFromContextMenu = eval(`(${extractMethod(downloadTargetMethodsSource, 'suggestDownloadSubfolderFromContextMenu')})`);
  const missing = {
    node_id: 19,
    widget_index: 2,
    subgraph_id: '',
    is_top_level: true,
  };
  const categoryEl = {
    closest() {
      return { id: 'download-target' };
    },
  };
  const subfolderEl = {};
  const calls = [];
  const dialog = {
    missingModels: [missing],
    contentElement: {
      querySelector(selector) {
        if (selector === '#download-category-19-2') return categoryEl;
        if (selector === '#download-subfolder-19-2') return subfolderEl;
        return null;
      },
    },
    getMissingModelKey() {
      return 'missing-19-2';
    },
    canSuggestDownloadSubfolderFromContextMenu() {
      return true;
    },
    getContextMenuDownloadMissing,
    async forceSuggestedDownloadSubfolder(...args) {
      calls.push(['suggest', ...args]);
      return {
        category: 'loras',
        subfolder: 'Krea 2/Concept',
      };
    },
    refreshDownloadTargetHelp(...args) {
      calls.push(['refresh', ...args]);
    },
    showNotification(...args) {
      calls.push(['notification', ...args]);
    },
  };

  await suggestDownloadSubfolderFromContextMenu.call(dialog, {
    context_scope: 'download_table',
    source: 'civitai',
    missing_key: 'missing-19-2',
    base_model: 'Krea 2',
    tags: ['concept'],
  });

  assert.equal(calls[0][0], 'suggest');
  assert.notEqual(calls[0][1], missing);
  assert.equal(calls[0][1].download_source.base_model, 'Krea 2');
  assert.deepEqual(calls[0][1].download_source.tags, ['concept']);
  assert.deepEqual(calls[0].slice(2), [categoryEl, subfolderEl]);
  assert.equal(calls[1][0], 'refresh');
  assert.equal(calls[1][2].download_source.base_model, 'Krea 2');
  assert.deepEqual(calls[1].slice(3), [categoryEl, subfolderEl]);
  assert.deepEqual(calls[2], [
    'notification',
    'Suggested subfolder applied: Krea 2/Concept',
    'success',
  ]);
});

test('context menu dispatches Suggest Subfolder without a silent optional handler', async () => {
  const handleContextMenuAction = eval(`(${extractMethod(modelInfoMethodsSource, 'handleContextMenuAction')})`);
  const model = {
    context_scope: 'download_table',
    source: 'civarchive',
    name: 'Cutifyier v2',
  };
  const calls = [];
  const dialog = {
    _contextMenuModel: model,
    hideContextMenu() {},
    suggestDownloadSubfolderFromContextMenu(value) {
      calls.push(value);
      return Promise.resolve();
    },
  };

  handleContextMenuAction.call(dialog, 'suggestSubfolder');
  await Promise.resolve();

  assert.deepEqual(calls, [model]);
});

test('clicked Krea 2 concept metadata resolves to the matching LoRA subfolder', () => {
  const normalizeFolderToken = eval(`(${extractMethod(downloadTargetMethodsSource, 'normalizeFolderToken')})`);
  const getSuggestedLoraSubfolder = eval(`(${extractMethod(downloadTargetMethodsSource, 'getSuggestedLoraSubfolder')})`);
  const dialog = {
    normalizeFolderToken,
    normalizeDownloadCategory(value = '') {
      return String(value || '').toLowerCase();
    },
    getCachedSearchSuggestionData() {
      return {};
    },
    getCompatibleCivitaiSearchResult() {
      return {};
    },
  };
  const suggestion = getSuggestedLoraSubfolder.call(dialog, {
    download_source: {
      base_model: 'Krea 2',
      tags: ['concept'],
    },
  }, 'loras', [{
    value: 'KREA2/concept',
    label: 'KREA2 / concept',
    baseDirectory: '',
    segments: ['KREA2', 'concept'],
    normalizedSegments: ['krea2', 'concept'],
  }]);

  assert.equal(suggestion.value, 'KREA2/concept');
  assert.equal(suggestion.matchedBaseModel, 'Krea 2');
  assert.equal(suggestion.matchedTag, 'concept');
});

test('queued workflow model selection survives missing data and completes after analysis', () => {
  const queueWorkflowModelReferenceSelection = eval(`(${extractMethod(missingBrowserMethodsSource, 'queueWorkflowModelReferenceSelection')})`);
  const applyPendingWorkflowModelSelection = eval(`(${extractMethod(missingBrowserMethodsSource, 'applyPendingWorkflowModelSelection')})`);
  const selectedModel = {
    node_id: 163,
    widget_index: 1,
    original_path: 'FLUX/ae.safetensors',
  };
  let analysisReady = false;
  const dialog = {
    pendingWorkflowModelSelection: null,
    queueWorkflowModelReferenceSelection,
    selectWorkflowModelReference() {
      return analysisReady ? selectedModel : null;
    },
  };

  const request = queueWorkflowModelReferenceSelection.call(dialog, selectedModel);

  assert.equal(request.status, 'pending');
  assert.equal(applyPendingWorkflowModelSelection.call(dialog, {}), null);
  assert.equal(dialog.pendingWorkflowModelSelection, request);

  analysisReady = true;
  assert.equal(applyPendingWorkflowModelSelection.call(dialog, {}), selectedModel);
  assert.equal(request.status, 'selected');
  assert.equal(request.selected, selectedModel);
  assert.equal(dialog.pendingWorkflowModelSelection, null);
});

test('a newer workflow model selection supersedes the previous pending request', () => {
  const queueWorkflowModelReferenceSelection = eval(`(${extractMethod(missingBrowserMethodsSource, 'queueWorkflowModelReferenceSelection')})`);
  const dialog = { pendingWorkflowModelSelection: null };

  const first = queueWorkflowModelReferenceSelection.call(dialog, { node_id: 1 });
  const second = queueWorkflowModelReferenceSelection.call(dialog, { node_id: 2 });

  assert.equal(first.status, 'superseded');
  assert.equal(second.status, 'pending');
  assert.equal(dialog.pendingWorkflowModelSelection, second);
});

test('workflow model selection wait resolves only after the queued request completes', async () => {
  const waitForWorkflowModelSelection = eval(`(${extractMethod(modelResolverSource, 'waitForWorkflowModelSelection')})`);
  const request = { status: 'pending' };
  const resolver = { dialog: { pendingWorkflowModelSelection: request } };

  setTimeout(() => {
    request.status = 'selected';
  }, 20);

  const completed = await waitForWorkflowModelSelection.call(resolver, request, 500);
  assert.equal(completed, request);
  assert.equal(completed.status, 'selected');
});

test('Show in Model Resolver reuses the visible Missing Models browser without reloading', async () => {
  const showResolvedNodeModelInResolver = eval(
    `(${extractMethod(modelResolverSource, 'showResolvedNodeModelInResolver')})`
  );
  const reference = {
    node_id: 7,
    widget_index: 0,
    original_path: 'model.safetensors',
  };
  const analysisData = { resolved_models: [reference] };
  const selectCalls = [];
  let loadCount = 0;
  let queueCount = 0;
  const previousLocalStorageDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    'localStorage'
  );
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { setItem() {} },
  });

  const resolver = {
    dialog: {
      activeTab: 'missing',
      cachedAnalysisData: analysisData,
      isVisible: () => true,
      persistActiveTab() {},
      selectWorkflowModelReference(...args) {
        selectCalls.push(args);
        return reference;
      },
      queueWorkflowModelReferenceSelection() {
        queueCount += 1;
        return { status: 'pending' };
      },
      async loadWorkflowData() {
        loadCount += 1;
      },
    },
    getNodeContextWorkflowState: () => ({ signature: 'current' }),
    getCurrentNodeContextAnalysis: () => analysisData,
    waitForResolverDialogReady: () => {
      throw new Error('The already visible browser should not wait for reopening');
    },
  };

  try {
    await showResolvedNodeModelInResolver.call(resolver, reference);
  } finally {
    if (previousLocalStorageDescriptor) {
      Object.defineProperty(
        globalThis,
        'localStorage',
        previousLocalStorageDescriptor
      );
    } else {
      delete globalThis.localStorage;
    }
  }

  assert.equal(loadCount, 0);
  assert.equal(queueCount, 0);
  assert.equal(selectCalls.length, 1);
  assert.equal(selectCalls[0][0], reference);
  assert.equal(selectCalls[0][1], analysisData);
  assert.deepEqual(selectCalls[0][2], { preferExistingBrowser: true });
});

test('workflow model selection patches the existing browser and centers its row', () => {
  const selectWorkflowModelReference = eval(
    `(${extractMethod(missingBrowserMethodsSource, 'selectWorkflowModelReference')})`
  );
  const selected = {
    node_id: 7,
    widget_index: 0,
    original_path: 'model.safetensors',
  };
  const row = {
    dataset: { missingKey: 'selected-key' },
    scrollIntoViewOptions: null,
    scrollIntoView(options) {
      this.scrollIntoViewOptions = options;
    },
  };
  const renderOptions = [];
  const previousRequestAnimationFrame = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = callback => callback();

  const dialog = {
    cachedAnalysisData: { resolved_models: [selected] },
    contentElement: {
      querySelectorAll: () => [row],
    },
    selectedMissingModelKey: 'previous-key',
    getResolvedWorkflowModels: data => data.resolved_models,
    getMissingModelKey: () => 'selected-key',
    displayMissingModels(_container, _data, options) {
      renderOptions.push(options);
    },
  };

  try {
    assert.equal(
      selectWorkflowModelReference.call(
        dialog,
        selected,
        dialog.cachedAnalysisData,
        { preferExistingBrowser: true }
      ),
      selected
    );
  } finally {
    if (previousRequestAnimationFrame) {
      globalThis.requestAnimationFrame = previousRequestAnimationFrame;
    } else {
      delete globalThis.requestAnimationFrame;
    }
  }

  assert.deepEqual(renderOptions, [{ selectionOnly: true }]);
  assert.deepEqual(row.scrollIntoViewOptions, {
    block: 'center',
    inline: 'nearest',
  });
});

test('Local Database source ignores installed local model matches before search', () => {
  const { hasMissingSourceSearchAttempt, getMissingSourceResultStatus } = missingModelStateMethods;
  const dialog = {
    hasMissingSourceSearchAttempt,
    getSearchResultStatusLevel: () => 'exact'
  };
  const missing = {
    matches: [{ confidence: 100, path: 'models/checkpoints/already-installed.safetensors' }],
    download_source: {
      source: 'model_list',
      url: 'https://example.invalid/model.safetensors'
    }
  };

  assert.equal(
    getMissingSourceResultStatus.call(dialog, missing, 'local', {
      results: { model_list: null, popular: null },
      explicitSearchSources: [],
      lastAttemptSources: ['local'],
      sourceProgress: { local: { status: 'found' } }
    }),
    ''
  );
});

test('Local Database source reports its result after Local Database or Everything search', () => {
  const {
    hasMissingSourceSearchAttempt,
    getMissingSourceResultStatus,
    getSearchResultStatusLevel,
  } = missingModelStateMethods;
  const dialog = { hasMissingSourceSearchAttempt, getSearchResultStatusLevel };

  for (const attemptedSource of ['local', 'all']) {
    assert.equal(
      getMissingSourceResultStatus.call(dialog, {}, 'local', {
        results: {
          model_list: { source: 'model_list', confidence: 100, match_type: 'exact' },
          popular: null
        },
        explicitSearchSources: [attemptedSource],
        lastAttemptSources: [],
        sourceProgress: {}
      }),
      'exact'
    );
  }
});

test('automatic Local Database download source stays hidden until that source is searched', () => {
  const {
    hasMissingSourceSearchAttempt,
    isLocalDatabaseDownloadSource,
    shouldDisplayKnownDownloadSource,
  } = missingModelStateMethods;
  const state = {
    selectedSource: 'all',
    explicitSearchSources: [],
    lastAttemptSources: [],
    sourceProgress: {}
  };
  const dialog = {
    searchResultCache: new Map([['missing-key', state]]),
    getMissingSearchKey: () => 'missing-key',
    hasMissingSourceSearchAttempt,
    isLocalDatabaseDownloadSource
  };
  const downloadSource = {
    source: 'model_list',
    url: 'https://example.invalid/model.safetensors'
  };

  assert.equal(shouldDisplayKnownDownloadSource.call(dialog, {}, downloadSource, state), false);
  state.explicitSearchSources = ['local'];
  assert.equal(shouldDisplayKnownDownloadSource.call(dialog, {}, downloadSource, state), true);
});

test('inactive missing models require every workflow reference to be inactive', () => {
  const { isMissingModelInactive } = missingModelStateMethods;

  assert.equal(isMissingModelInactive({ connected: false }), true);
  assert.equal(isMissingModelInactive({ active: false, connected: true }), true);
  assert.equal(isMissingModelInactive({
    all_node_refs: [{ connected: false }, { connected: true }]
  }), false);
  assert.equal(isMissingModelInactive({
    all_node_refs: [{ connected: false }, { active: false }]
  }), true);
});

test('html template escapes every item in interpolated arrays', () => {
  const rendered = html`<div>${['<script>', '"quoted"', '&value']}</div>`;

  assert.equal(
    rendered,
    '<div>&lt;script&gt;&quot;quoted&quot;&amp;value</div>'
  );
});

function extractMethod(source, methodName, paramsPattern = '[^)]*') {
  const signatureRegex = new RegExp(`\\n\\s+(async\\s+)?${methodName}\\s*\\(${paramsPattern}\\)\\s*\\{`);
  const match = signatureRegex.exec(source);
  assert.ok(match, `Could not find ${methodName}`);
  const isAsync = Boolean(match[1]);

  const parenStart = source.indexOf('(', match.index);
  const parenEnd = source.indexOf(')', parenStart);
  const params = source.slice(parenStart + 1, parenEnd);
  const braceStart = source.indexOf('{', parenEnd);
  let depth = 0;
  for (let i = braceStart; i < source.length; i += 1) {
    const char = source[i];
    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;
    if (depth === 0) {
      return `${isAsync ? 'async ' : ''}function ${methodName}(${params}) ${source.slice(braceStart, i + 1)}`;
    }
  }
  throw new Error(`Could not parse ${methodName}`);
}

test('model info hash readers preserve field precedence and casing', () => {
  const getInfoDialogHash = eval(`(${extractMethod(modelInfoMethodsSource, 'getInfoDialogHash')})`);
  const getSourceModelFileHash = eval(`(${extractMethod(modelInfoMethodsSource, 'getSourceModelFileHash')})`);
  const getSourceModelDisplayHash = eval(`(${extractMethod(modelInfoMethodsSource, 'getSourceModelDisplayHash')})`);
  const value = {
    sha256: '  DirectHash  ',
    hash: 'FallbackHash',
    hashes: { SHA256: 'NestedHash' },
  };

  assert.equal(getInfoDialogHash(value), 'DirectHash');
  assert.equal(getSourceModelFileHash(value), 'directhash');
  assert.equal(getSourceModelDisplayHash(value), 'DirectHash');
  assert.equal(getInfoDialogHash({ hashes: { sha256: ' NestedHash ' } }), 'NestedHash');
  assert.equal(getSourceModelFileHash({}), '');
  assert.equal(getSourceModelDisplayHash({}), '');
});

test('model info metadata source labels match the shared source label contract', () => {
  const getInfoMetadataSourceLabel = eval(`(${extractMethod(modelInfoMethodsSource, 'getInfoMetadataSourceLabel')})`);
  const dialog = {
    sourceKey: 'metadata',
    getInfoMetadataSourceKey() {
      return this.sourceKey;
    },
  };

  const expectedLabels = new Map([
    ['huggingface', 'HuggingFace'],
    ['civarchive', 'CivArchive'],
    ['civitai', 'CivitAI'],
    ['lora_manager_archive', 'LoRA Archive'],
    ['metadata', 'metadata source'],
  ]);

  for (const [sourceKey, expectedLabel] of expectedLabels) {
    dialog.sourceKey = sourceKey;
    assert.equal(getInfoMetadataSourceLabel.call(dialog), expectedLabel);
  }
});

test('workflow signature tracks model strength for bypass and custom LoRA loaders', () => {
  const getWorkflowSignatureData = eval(`(${extractMethod(workflowStateMethodsSource, 'getWorkflowSignatureData')})`);
  const dialog = { capabilities: { node_rules: {} } };
  const makeWorkflow = (type, strengthName, strength) => ({
    nodes: [{
      id: 34,
      type,
      inputs: [
        { name: 'model', type: 'MODEL', link: 1 },
        { name: 'clip', type: 'CLIP', link: 2 },
        { name: 'lora_name', widget: { name: 'lora_name' } },
        { name: strengthName, widget: { name: strengthName } },
      ],
      outputs: [],
      widgets_values: ['AnimeEditV2.safetensors', strength],
    }],
    links: [],
  });

  const bypass = getWorkflowSignatureData.call(
    dialog,
    makeWorkflow('LoraLoaderBypass', 'strength_model', 0.65)
  );
  const custom = getWorkflowSignatureData.call(
    dialog,
    makeWorkflow('easy fullLoader', 'lora_model_strength', 0.8)
  );

  assert.deepEqual(bypass.nodes[0].widgets_values, [
    { index: 0, value: 'AnimeEditV2.safetensors' },
    { index: 1, value: 0.65 },
  ]);
  assert.deepEqual(custom.nodes[0].widgets_values, [
    { index: 0, value: 'AnimeEditV2.safetensors' },
    { index: 1, value: 0.8 },
  ]);
});

test('workflow signature tracks EasyLoraStack mode and indexed strengths', () => {
  const getWorkflowSignatureData = eval(`(${extractMethod(workflowStateMethodsSource, 'getWorkflowSignatureData')})`);
  const dialog = {
    capabilities: {
      node_rules: {
        'easy loraStack': { 3: 'loras', 7: 'loras' },
      },
    },
  };
  const widgetNames = [
    'toggle',
    'mode',
    'num_loras',
    'lora_1_name',
    'lora_1_strength',
    'lora_1_model_strength',
    'lora_1_clip_strength',
  ];
  const workflow = {
    nodes: [{
      id: 160,
      type: 'easy loraStack',
      inputs: widgetNames.map(name => ({ name, widget: { name } })),
      outputs: [],
      widgets_values: [
        true,
        'advanced',
        1,
        'nsfw_flux_lora_v1.safetensors',
        1,
        0.45,
        0.25,
      ],
    }],
    links: [],
  };

  const signature = getWorkflowSignatureData.call(dialog, workflow);

  assert.deepEqual(signature.nodes[0].widgets_values, [
    { index: 0, value: true },
    { index: 1, value: 'advanced' },
    { index: 2, value: 1 },
    { index: 3, value: 'nsfw_flux_lora_v1.safetensors' },
    { index: 4, value: 1 },
    { index: 5, value: 0.45 },
    { index: 6, value: 0.25 },
  ]);
});

test('Missing Models signature ignores strength but tracks model identity changes', () => {
  const getWorkflowSignature = eval(`(${extractMethod(workflowStateMethodsSource, 'getWorkflowSignature')})`);
  const getMissingWorkflowSignature = eval(`(${extractMethod(workflowStateMethodsSource, 'getMissingWorkflowSignature')})`);
  const getWorkflowSignatureData = eval(`(${extractMethod(workflowStateMethodsSource, 'getWorkflowSignatureData')})`);
  const dialog = {
    capabilities: { node_rules: {} },
    getWorkflowSignature,
    getMissingWorkflowSignature,
    getWorkflowSignatureData,
  };
  const makeWorkflow = (modelName, strength) => ({
    nodes: [{
      id: 34,
      type: 'LoraLoader',
      inputs: [
        { name: 'lora_name', widget: { name: 'lora_name' } },
        { name: 'strength_model', widget: { name: 'strength_model' } },
      ],
      outputs: [],
      widgets_values: [modelName, strength],
    }],
    links: [],
  });
  const original = makeWorkflow('AnimeEditV2.safetensors', 0.65);
  const strengthChanged = makeWorkflow('AnimeEditV2.safetensors', 1.25);
  const modelChanged = makeWorkflow('AnotherModel.safetensors', 1.25);

  assert.notEqual(
    getWorkflowSignature.call(dialog, original),
    getWorkflowSignature.call(dialog, strengthChanged)
  );
  assert.equal(
    getMissingWorkflowSignature.call(dialog, original),
    getMissingWorkflowSignature.call(dialog, strengthChanged)
  );
  assert.notEqual(
    getMissingWorkflowSignature.call(dialog, strengthChanged),
    getMissingWorkflowSignature.call(dialog, modelChanged)
  );
});

test('Missing Models signature tracks LoRA Manager list membership changes', () => {
  const getWorkflowSignature = eval(`(${extractMethod(workflowStateMethodsSource, 'getWorkflowSignature')})`);
  const getMissingWorkflowSignature = eval(`(${extractMethod(workflowStateMethodsSource, 'getMissingWorkflowSignature')})`);
  const getWorkflowSignatureData = eval(`(${extractMethod(workflowStateMethodsSource, 'getWorkflowSignatureData')})`);
  const dialog = {
    capabilities: { node_rules: {} },
    getWorkflowSignature,
    getMissingWorkflowSignature,
    getWorkflowSignatureData,
  };
  const makeWorkflow = (loras) => ({
    nodes: [{
      id: 83,
      type: 'Lora Loader (LoraManager)',
      widgets_values: [
        { version: 1, textWidgetName: 'text' },
        '<lora:first:1>',
        loras,
      ],
    }],
    links: [],
  });
  const original = makeWorkflow([
    { name: 'first', strength: 1, active: true },
  ]);
  const strengthChanged = makeWorkflow([
    { name: 'first', strength: 0.5, active: true },
  ]);
  const loraAdded = makeWorkflow([
    { name: 'first', strength: 0.5, active: true },
    { name: 'second', strength: 1, active: true },
  ]);

  assert.equal(
    getMissingWorkflowSignature.call(dialog, original),
    getMissingWorkflowSignature.call(dialog, strengthChanged)
  );
  assert.notEqual(
    getMissingWorkflowSignature.call(dialog, strengthChanged),
    getMissingWorkflowSignature.call(dialog, loraAdded)
  );
});

test('workflow hash refresh ignores node movement and tracks model dependency changes', () => {
  const getWorkflowSignature = eval(`(${extractMethod(workflowStateMethodsSource, 'getWorkflowSignature')})`);
  const getMissingWorkflowSignature = eval(`(${extractMethod(workflowStateMethodsSource, 'getMissingWorkflowSignature')})`);
  const getWorkflowSignatureData = eval(`(${extractMethod(workflowStateMethodsSource, 'getWorkflowSignatureData')})`);
  const getWorkflowHashMetadataSignature = eval(`(${extractMethod(modelResolverSource, 'getWorkflowHashMetadataSignature')})`);
  const scheduleWorkflowHashMetadataRefresh = eval(`(${extractMethod(modelResolverSource, 'scheduleWorkflowHashMetadataRefresh')})`);
  const dialog = {
    capabilities: { node_rules: {} },
    getWorkflowSignature,
    getMissingWorkflowSignature,
    getWorkflowSignatureData,
  };
  const makeWorkflow = (modelName, position = [0, 0], strength = 0.75) => ({
    nodes: [{
      id: 12,
      type: 'LoraLoader',
      pos: position,
      size: [320, 120],
      inputs: [
        { name: 'lora_name', widget: { name: 'lora_name' } },
        { name: 'strength_model', widget: { name: 'strength_model' } },
      ],
      outputs: [{ name: 'MODEL', type: 'MODEL', links: [] }],
      widgets_values: [modelName, strength],
    }],
    links: [],
    definitions: {
      subgraphs: [{
        id: 'subgraph-a',
        name: 'Nested loader',
        nodes: [{
          id: 3,
          type: 'VAELoader',
          pos: [20, 30],
          inputs: [{ name: 'vae_name', widget: { name: 'vae_name' } }],
          outputs: [],
          widgets_values: ['vae-a.safetensors'],
        }],
        links: [],
      }],
    },
  });
  const originalWorkflow = makeWorkflow('model-a.safetensors');
  const originalSignature = getWorkflowHashMetadataSignature.call(
    { dialog },
    originalWorkflow
  );
  const resolver = {
    dialog,
    workflowHashMetadataSignature: originalSignature,
    workflowHashMetadataActiveSignature: null,
    workflowHashMetadataRefreshPending: false,
    workflowHashMetadataPendingSignature: null,
    workflowHashMetadataPreparing: false,
    isWorkflowHashMetadataEnabled: () => true,
    getWorkflowHashMetadataSignature,
    armCalls: 0,
    armWorkflowHashMetadataRefresh() {
      this.armCalls += 1;
    },
  };
  const movedWorkflow = makeWorkflow('model-a.safetensors', [800, 450]);
  movedWorkflow.definitions.subgraphs[0].nodes[0].pos = [640, 320];

  scheduleWorkflowHashMetadataRefresh.call(
    resolver,
    movedWorkflow
  );
  assert.equal(resolver.armCalls, 0);
  assert.equal(resolver.workflowHashMetadataRefreshPending, false);

  scheduleWorkflowHashMetadataRefresh.call(
    resolver,
    makeWorkflow('model-a.safetensors', [800, 450], 1.25)
  );
  assert.equal(resolver.armCalls, 0);
  assert.equal(resolver.workflowHashMetadataRefreshPending, false);

  scheduleWorkflowHashMetadataRefresh.call(
    resolver,
    makeWorkflow('model-b.safetensors', [800, 450])
  );
  assert.equal(resolver.armCalls, 1);
  assert.equal(resolver.workflowHashMetadataRefreshPending, true);
  assert.notEqual(resolver.workflowHashMetadataPendingSignature, originalSignature);
});

test('workflow route stays rooted while navigating into a subgraph', () => {
  const getActiveWorkflowRouteKey = eval(
    `(${extractMethod(workflowStateMethodsSource, 'getActiveWorkflowRouteKey')})`
  );
  const previousApp = globalThis.app;
  const previousWindow = globalThis.window;

  globalThis.app = {
    graph: {
      id: 'root-workflow-id',
      rootGraph: { id: 'root-workflow-id' },
    },
    canvas: {
      graph: { id: 'nested-subgraph-id' },
    },
  };
  globalThis.window = {
    location: { hash: '#nested-subgraph-id' },
  };

  try {
    assert.equal(getActiveWorkflowRouteKey.call({}), '#root-workflow-id');
  } finally {
    if (previousApp === undefined) delete globalThis.app;
    else globalThis.app = previousApp;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test('download percent keeps native Xet progress below one percent visible', () => {
  const formatDownloadPercent = eval(`(${extractMethod(renderFormatMethodsSource, 'formatDownloadPercent')})`);

  assert.equal(formatDownloadPercent(0), '0');
  assert.equal(formatDownloadPercent(0.04), '<0.1');
  assert.equal(formatDownloadPercent(0.75), '0.8');
  assert.equal(formatDownloadPercent(7), '7');
  assert.equal(formatDownloadPercent(10.4), '10');
});

test('native Xet ETA uses network bytes against the known final file size', () => {
  const formatDuration = eval(`(${extractMethod(renderFormatMethodsSource, 'formatDuration')})`);
  const getDownloadEtaText = eval(`(${extractMethod(renderFormatMethodsSource, 'getDownloadEtaText')})`);
  const dialog = { formatDuration };

  assert.equal(getDownloadEtaText.call(dialog, {
    download_backend: 'huggingface_xet',
    total_size: 10_000,
    downloaded: 2_000,
    transfer_total_size: 400,
    transfer_downloaded: 100,
    speed: 10
  }), 'ETA 16m 30s');

  assert.equal(getDownloadEtaText.call(dialog, {
    download_backend: 'python',
    total_size: 400,
    downloaded: 100,
    speed: 10
  }), 'ETA 30s');
});

test('native Xet progress bar uses live network bytes against the known final file size', () => {
  const getDownloadDisplayProgress = eval(`(${extractMethod(renderFormatMethodsSource, 'getDownloadDisplayProgress')})`);

  assert.deepEqual(getDownloadDisplayProgress({
    download_backend: 'huggingface_xet',
    total_size: 10_000,
    downloaded: 2_000,
    progress: 20,
    transfer_total_size: 400,
    transfer_downloaded: 100,
    transfer_progress: 25
  }), {
    percent: 1,
    downloaded: 100,
    totalSize: 10_000,
    isTransfer: true,
    isFinalizing: false
  });

  assert.equal(getDownloadDisplayProgress({
    download_backend: 'huggingface_xet',
    total_size: 10_000,
    downloaded: 9_000,
    progress: 90,
    transfer_total_size: 400,
    transfer_downloaded: 400,
    transfer_progress: 100
  }).isFinalizing, true);

  assert.equal(getDownloadDisplayProgress({
    download_backend: 'python',
    total_size: 10_000,
    downloaded: 2_000,
    progress: 20
  }).percent, 20);
});

test('download progress presentation combines display and logical size labels', () => {
  const getDownloadProgressPresentation = eval(
    `(${extractMethod(renderFormatMethodsSource, 'getDownloadProgressPresentation')})`
  );
  const dialog = {
    getDownloadDisplayProgress: () => ({
      percent: 42.5,
      downloaded: 100,
      totalSize: 250,
      isTransfer: true,
      isFinalizing: false,
    }),
    formatBytes: value => `${value} B`,
    formatDownloadProgressMeta: () => 'meta',
    formatDownloadPercent: value => `${value}%`,
  };

  assert.deepEqual(
    getDownloadProgressPresentation.call(dialog, {
      downloaded: 80,
      total_size: 200,
    }, { unknownTotal: 'Unknown' }),
    {
      percent: 42.5,
      downloaded: 100,
      totalSize: 250,
      isTransfer: true,
      isFinalizing: false,
      percentLabel: '42.5%',
      downloadedText: '100 B',
      totalText: '250 B',
      progressMeta: 'meta',
      logicalDownloadedText: '80 B',
      logicalTotalText: '200 B',
    }
  );
});

test('base model alias resolves FLUX KREA as Flux.1 Krea', () => {
  const {
    normalizeBaseModelToken,
    getBaseModelTokenVariants,
    resolveBaseModelAliasExact,
    resolveBaseModelAlias,
  } = baseModelAliasMethods;
  const dialog = {
    baseModels: {
      base_models: [
        { name: 'Flux.1 Krea', aliases: ['Flux.1 Krea', 'flux 1 krea'] },
        { name: 'Krea 2', aliases: ['krea', 'krea 2'] }
      ]
    },
    normalizeBaseModelToken,
    getBaseModelTokenVariants,
    resolveBaseModelAliasExact,
    resolveBaseModelAlias,
    getBaseModelAliases() {
      return this.baseModels.base_models.map(model => ({
        value: model.name,
        aliases: model.aliases || []
      }));
    }
  };

  assert.equal(resolveBaseModelAlias.call(dialog, 'FLUX KREA'), 'Flux.1 Krea');
  assert.equal(resolveBaseModelAlias.call(dialog, 'KREA'), 'Krea 2');
});

test('auto base model uses Any model for standalone SAM and Ultralytics models', () => {
  const getBaseModelIndependentSearchType = eval(`(${extractMethod(searchPanelMethodsSource, 'getBaseModelIndependentSearchType')})`);
  const getMissingAutoBaseModelInfo = eval(`(${extractMethod(searchPanelMethodsSource, 'getMissingAutoBaseModelInfo')})`);
  const getMissingAutoBaseModel = eval(`(${extractMethod(searchPanelMethodsSource, 'getMissingAutoBaseModel')})`);
  const getSearchBaseModelLabel = eval(`(${extractMethod(searchPanelMethodsSource, 'getSearchBaseModelLabel')})`);
  const getSearchBaseModelContext = eval(`(${extractMethod(searchPanelMethodsSource, 'getSearchBaseModelContext')})`);
  const state = { selectedBaseModel: 'auto' };
  const dialog = {
    getBaseModelIndependentSearchType,
    getMissingAutoBaseModelInfo,
    getMissingAutoBaseModel,
    getSearchBaseModelLabel,
    getSearchBaseModelContext,
    getSearchState() {
      return state;
    },
    getDefaultSearchBaseModel() {
      return 'auto';
    },
    getDominantWorkflowBaseModel() {
      return 'SDXL 1.0';
    }
  };

  for (const missing of [
    { category: 'sams', node_type: 'SAMLoader' },
    { category: 'ultralytics', node_type: 'UltralyticsDetectorProvider' }
  ]) {
    assert.equal(getMissingAutoBaseModel.call(dialog, missing), '');
    assert.equal(getSearchBaseModelLabel.call(dialog, 'auto', missing), 'Auto (Any model)');
    assert.equal(getSearchBaseModelContext.call(dialog, missing), '');
    assert.match(getMissingAutoBaseModelInfo.call(dialog, missing).message, /Selected automatically: Any model/);
    assert.match(getMissingAutoBaseModelInfo.call(dialog, missing).message, /no model filter is needed/);
  }

  state.selectedBaseModel = 'SDXL 1.0';
  assert.equal(
    getSearchBaseModelContext.call(dialog, { category: 'sams' }),
    'SDXL 1.0',
    'Manual base model selection should remain available'
  );
});

test('auto base model keeps workflow path context when a delayed search result disagrees', () => {
  const getMissingAutoBaseModelInfo = eval(`(${extractMethod(searchPanelMethodsSource, 'getMissingAutoBaseModelInfo')})`);
  const missing = {
    original_path: 'KREA2\\KNPV3_1.safetensors',
    civitai_search_result: { base_model: 'Flux.1 D' }
  };
  const dialog = {
    getBaseModelIndependentSearchType() {
      return '';
    },
    getCachedSearchSuggestionData() {
      return { base_model: 'Flux.1 D' };
    },
    getSavedDownloadTargetSelection() {
      return {
        subfolder: 'FLUX',
        subfolderTouched: false,
        subfolderSuggestionAppliedBy: 'auto'
      };
    },
    getMissingLocalBaseModel() {
      return '';
    },
    resolveBaseModelAlias(value = '') {
      if (value === 'Flux.1 D') return 'Flux.1 D';
      if (value === 'Krea 2') return 'Krea 2';
      return '';
    },
    resolveBaseModelAliasExact(value = '') {
      return this.resolveBaseModelAlias(value);
    },
    resolveBaseModelAliasFromPath(value = '') {
      return /(^|[\\/])KREA2([\\/]|$)/i.test(String(value)) ? 'Krea 2' : '';
    },
    getDominantWorkflowBaseModel() {
      return 'Flux.1 D';
    }
  };

  const info = getMissingAutoBaseModelInfo.call(dialog, missing);

  assert.equal(info.value, 'Krea 2');
  assert.equal(info.source, 'missing model path');
  assert.match(info.message, /Selected automatically: Krea 2/);
  assert.match(info.message, /Why: The model path saved in this workflow/);
  assert.match(info.message, /To change: Choose a different option in the Model field/);
});

test('base model path mapping ignores conflicting full-path base model', () => {
  const {
    normalizeBaseModelToken,
    getBaseModelTokenVariants,
    resolveBaseModelAliasExact,
    resolveBaseModelAlias,
  } = baseModelAliasMethods;
  const isBaseModelPathMappingCompatible = eval(`(${extractMethod(downloadTargetMethodsSource, 'isBaseModelPathMappingCompatible')})`);
  const resolveBaseModelPathMapping = eval(`(${extractMethod(downloadTargetMethodsSource, 'resolveBaseModelPathMapping')})`);
  const dialog = {
    baseModels: {
      base_models: [
        { name: 'Flux.1 Krea', aliases: ['Flux.1 Krea', 'flux 1 krea'] },
        { name: 'Krea 2', aliases: ['krea', 'krea 2'] },
        { name: 'Pony', aliases: ['pony', 'ponyxl'] },
        { name: 'SDXL 1.0', aliases: ['sdxl', 'sdxl10'] }
      ]
    },
    normalizeBaseModelToken,
    getBaseModelTokenVariants,
    resolveBaseModelAliasExact,
    resolveBaseModelAlias,
    isBaseModelPathMappingCompatible,
    resolveBaseModelPathMapping,
    getBaseModelAliases() {
      return this.baseModels.base_models.map(model => ({
        value: model.name,
        aliases: model.aliases || []
      }));
    }
  };

  assert.equal(
    resolveBaseModelPathMapping.call(dialog, 'Krea 2', { 'Krea 2': 'FLUX/KREA' }),
    'Krea 2'
  );
  assert.equal(
    resolveBaseModelPathMapping.call(dialog, 'Pony', { Pony: 'SDXL/Pony' }),
    'SDXL/Pony'
  );
});

test('download subfolder tooltip explains automatic suggestion source', () => {
  const getDownloadSubfolderTooltip = eval(`(${extractMethod(downloadTargetMethodsSource, 'getDownloadSubfolderTooltip')})`);
  const getDownloadSubfolderSuggestionReason = eval(`(${extractMethod(downloadTargetMethodsSource, 'getDownloadSubfolderSuggestionReason')})`);
  const getSavedDownloadSubfolderSuggestion = eval(`(${extractMethod(downloadTargetMethodsSource, 'getSavedDownloadSubfolderSuggestion')})`);
  const getCurrentDownloadSubfolderSuggestion = eval(`(${extractMethod(downloadTargetMethodsSource, 'getCurrentDownloadSubfolderSuggestion')})`);
  const normalizeDownloadPathValue = eval(`(${extractMethod(downloadTargetMethodsSource, 'normalizeDownloadPathValue')})`);

  const dialog = {
    getDownloadSubfolderTooltip,
    getDownloadSubfolderSuggestionReason,
    getSavedDownloadSubfolderSuggestion,
    getCurrentDownloadSubfolderSuggestion,
    normalizeDownloadPathValue,
    normalizePathToForward(value) {
      return String(value || '').replace(/\\/g, '/');
    },
    normalizeDownloadCategory(value) {
      return String(value || 'checkpoints');
    },
    getCategoryDisplayName(value) {
      return value === 'loras' ? 'lora' : value;
    },
    getSavedDownloadTargetSelection() {
      return null;
    },
    getDownloadPathMode() {
      return 'suggested';
    },
    isAutoFillSubfolderEnabled() {
      return true;
    },
    getAvailableSubfolders() {
      return [];
    },
    getSuggestedDownloadSubfolder() {
      return {
        value: 'SDXL\\Style',
        baseDirectory: '',
        suggestionSource: 'lora_metadata',
        matchedBaseModel: 'SDXL',
        matchedTag: 'style'
      };
    }
  };

  const tooltip = getDownloadSubfolderTooltip.call(dialog, { node_id: 1 }, 'loras', 'SDXL/Style');

  assert.match(tooltip, /Suggested subfolder: SDXL\/Style/);
  assert.match(tooltip, /identified as SDXL and tagged/);
});

test('portable subfolder paths use forward slashes and join to the host path style', () => {
  const normalizeDownloadPathValue = eval(`(${extractMethod(downloadTargetMethodsSource, 'normalizeDownloadPathValue')})`);
  const joinLocalPath = eval(`(${extractMethod(downloadTargetMethodsSource, 'joinLocalPath')})`);
  const dialog = {
    normalizeDownloadPathValue,
    joinLocalPath,
    normalizePathToForward(value) {
      return String(value || '').trim().replace(/\\/g, '/');
    }
  };

  assert.equal(normalizeDownloadPathValue.call(dialog, 'Pony\\Styles'), 'Pony/Styles');
  assert.equal(normalizeDownloadPathValue.call(dialog, 'Pony/Styles'), 'Pony/Styles');
  assert.equal(
    joinLocalPath.call(dialog, '/models/loras', 'Pony\\Styles'),
    '/models/loras/Pony/Styles'
  );
  assert.equal(
    joinLocalPath.call(dialog, 'C:\\models\\loras', 'Pony/Styles'),
    'C:\\models\\loras\\Pony\\Styles'
  );
  assert.equal(
    joinLocalPath.call(dialog, '/', 'models\\Pony'),
    '/models/Pony'
  );
  assert.equal(
    joinLocalPath.call(dialog, '/models/literal\\name', 'Pony\\Styles'),
    '/models/literal\\name/Pony/Styles'
  );
  assert.equal(
    joinLocalPath.call(dialog, 'C:\\', 'Pony/Styles'),
    'C:\\Pony\\Styles'
  );
  assert.equal(
    joinLocalPath.call(dialog, '\\\\server\\share\\', 'Pony/Styles'),
    '\\\\server\\share\\Pony\\Styles'
  );
});

test('download subfolder and path template normalization apply the same segment rules', () => {
  const normalizeDownloadPathValue = eval(`(${extractMethod(downloadTargetMethodsSource, 'normalizeDownloadPathValue')})`);
  const dialog = {
    normalizePathToForward(value) {
      return String(value || '').replace(/\\/g, '/');
    }
  };
  const input = ' Pony\\Styles / . / .. / {author} ';

  assert.equal(
    normalizeDownloadPathValue.call(dialog, input),
    'Pony/Styles/{author}'
  );
});

test('download path templates render metadata into the configured subfolder', () => {
  const formatDownloadPathTemplate = eval(
    `(${extractMethod(downloadTargetMethodsSource, 'formatDownloadPathTemplate')})`
  );
  const calculateDownloadPathTemplateSubfolder = eval(
    `(${extractMethod(downloadTargetMethodsSource, 'calculateDownloadPathTemplateSubfolder')})`
  );
  const dialog = {
    getDownloadPathTemplates() {
      return { loras: '{base_model}/{author}/{first_tag}/{model_name}/{version_name}/{unknown}' };
    },
    normalizeDownloadCategory(value) {
      return value;
    },
    formatDownloadPathTemplate,
    normalizeDownloadPathValue(value) {
      return String(value || '').replace(/\\/g, '/');
    },
    getBaseModelPathMappings() {
      return { Pony: 'SDXL/Pony' };
    },
    resolveBaseModelPathMapping(value, mappings) {
      return mappings[value] || value;
    },
    sanitizeDownloadPathValue(value, fallback) {
      return value || fallback;
    },
    sanitizeDownloadPathSegment(value, fallback) {
      return value || fallback;
    },
    getPriorityDownloadTag(tags) {
      return tags?.[0] || '';
    },
    normalizeTemplateSubfolder(value) {
      return String(value || '')
        .split('/')
        .filter(Boolean)
        .join('/');
    },
  };

  assert.equal(
    calculateDownloadPathTemplateSubfolder.call(dialog, 'loras', {
      base_model: 'Pony',
      author: 'Creator',
      tags: ['Style'],
      model_name: 'Model',
      version_name: 'v1',
    }),
    'SDXL/Pony/Creator/Style/Model/v1'
  );
  assert.equal(
    formatDownloadPathTemplate.call(dialog, '{base_model}/{unknown}', {
      '{base_model}': 'SDXL',
    }),
    'SDXL'
  );
});

test('options path preview delegates token rendering to the shared template formatter', () => {
  assert.match(optionsMethodsSource, /this\.formatDownloadPathTemplate\(template, replacements\)/);
  assert.doesNotMatch(optionsMethodsSource, /formatted\.split\(token\)\.join\(value\)/);
});

test('download subfolder tooltip identifies a folder taken from the workflow model path', () => {
  const getDownloadSubfolderSuggestionReason = eval(`(${extractMethod(downloadTargetMethodsSource, 'getDownloadSubfolderSuggestionReason')})`);
  const dialog = {
    normalizeFolderToken(value = '') {
      return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
    }
  };

  const reason = getDownloadSubfolderSuggestionReason.call(dialog, {
    suggestionSource: 'model_name',
    matchedCandidate: 'KREA2'
  }, {
    original_path: 'KREA2\\KNPV3_1.safetensors'
  });

  assert.match(reason, /model path saved in this workflow.*folder.*KREA2/);
});

test('download subfolder tooltip explains Suggest button choice', () => {
  const getDownloadSubfolderTooltip = eval(`(${extractMethod(downloadTargetMethodsSource, 'getDownloadSubfolderTooltip')})`);
  const getDownloadSubfolderSuggestionReason = eval(`(${extractMethod(downloadTargetMethodsSource, 'getDownloadSubfolderSuggestionReason')})`);
  const getSavedDownloadSubfolderSuggestion = eval(`(${extractMethod(downloadTargetMethodsSource, 'getSavedDownloadSubfolderSuggestion')})`);
  const getCurrentDownloadSubfolderSuggestion = eval(`(${extractMethod(downloadTargetMethodsSource, 'getCurrentDownloadSubfolderSuggestion')})`);
  const normalizeDownloadPathValue = eval(`(${extractMethod(downloadTargetMethodsSource, 'normalizeDownloadPathValue')})`);
  const saved = {
    subfolder: 'Pony\\Styles',
    subfolderBaseDirectory: '',
    subfolderTouched: true,
    subfolderSuggestionSource: 'template',
    subfolderSuggestionAppliedBy: 'button',
    subfolderSuggestionTemplate: '{base_model}/{first_tag}'
  };

  const dialog = {
    getDownloadSubfolderTooltip,
    getDownloadSubfolderSuggestionReason,
    getSavedDownloadSubfolderSuggestion,
    getCurrentDownloadSubfolderSuggestion,
    normalizeDownloadPathValue,
    normalizePathToForward(value) {
      return String(value || '').replace(/\\/g, '/');
    },
    normalizeDownloadCategory(value) {
      return String(value || 'checkpoints');
    },
    getCategoryDisplayName(value) {
      return value;
    },
    getSavedDownloadTargetSelection() {
      return saved;
    },
    getDownloadPathMode() {
      return 'suggested';
    },
    isAutoFillSubfolderEnabled() {
      return true;
    }
  };

  const tooltip = getDownloadSubfolderTooltip.call(dialog, { node_id: 1 }, 'loras', 'Pony\\Styles', { saved });

  assert.match(tooltip, /Selected with Suggest: Pony\/Styles/);
  assert.match(tooltip, /saved folder rule.*\{base_model\}\/\{first_tag\}/);
});

test('post-search subfolder suggestion can prefer path template metadata', () => {
  const getSuggestedDownloadSubfolder = eval(`(${extractMethod(downloadTargetMethodsSource, 'getSuggestedDownloadSubfolder')})`);
  const calls = [];
  const dialog = {
    getSuggestedDownloadSubfolder,
    getDownloadPathMode() {
      return 'suggested';
    },
    getFolderSuggestionEntries() {
      return [{ value: 'SDXL', normalizedSegments: ['sdxl'], segments: ['SDXL'] }];
    },
    getTemplateSubfolderSuggestionFromMetadata() {
      calls.push('template');
      return { value: 'SDXL\\style', suggestionSource: 'template' };
    },
    getSuggestedLoraSubfolder() {
      calls.push('lora');
      return { value: 'SDXL', suggestionSource: 'lora_metadata' };
    },
    getSuggestedExistingSubfolderByModelName() {
      calls.push('name');
      return null;
    }
  };

  const normalSuggestion = getSuggestedDownloadSubfolder.call(dialog, {}, 'loras', []);
  const searchSuggestion = getSuggestedDownloadSubfolder.call(dialog, {}, 'loras', [], { preferTemplate: true });

  assert.equal(normalSuggestion.value, 'SDXL');
  assert.equal(searchSuggestion.value, 'SDXL\\style');
});

test('post-search auto-fill can refresh earlier suggested subfolder', async () => {
  const applySuggestedDownloadSubfolder = eval(`(${extractMethod(downloadTargetMethodsSource, 'applySuggestedDownloadSubfolder')})`);
  const getSubfolderSuggestionTrackingPatch = eval(`(${extractMethod(downloadTargetMethodsSource, 'getSubfolderSuggestionTrackingPatch')})`);
  const saved = {
    category: 'loras',
    subfolder: 'SDXL',
    subfolderBaseDirectory: '',
    subfolderTouched: true,
    subfolderSuggestionAppliedBy: 'button'
  };
  const saves = [];
  const categoryEl = { dataset: { value: 'loras' } };
  const subfolderEl = { value: 'SDXL', dataset: { baseDirectory: '' } };
  const dialog = {
    applySuggestedDownloadSubfolder,
    getSubfolderSuggestionTrackingPatch,
    isAutoFillSubfolderEnabled() {
      return true;
    },
    normalizeDownloadCategory(value) {
      return String(value || '');
    },
    normalizeDownloadPathValue(value) {
      return String(value || '').replace(/\\/g, '/');
    },
    getDropdownValue(element) {
      return element.dataset.value;
    },
    getSuggestedDownloadCategory() {
      return 'loras';
    },
    shouldPreserveSavedDownloadCategory() {
      return false;
    },
    getSavedDownloadTargetSelection() {
      return saved;
    },
    async ensureDownloadSubfoldersLoaded() {},
    getAvailableSubfolders() {
      return [];
    },
    getSuggestedDownloadSubfolder(_missing, _category, _folders, options) {
      assert.equal(options.preferTemplate, true);
      return {
        value: 'SDXL\\style',
        baseDirectory: '',
        suggestionSource: 'template',
        template: '{base_model}/{first_tag}'
      };
    },
    saveDownloadTargetSelection(_missing, patch) {
      saves.push(patch);
      Object.assign(saved, patch);
    },
    syncDownloadTargetFolderContext() {}
  };

  await applySuggestedDownloadSubfolder.call(dialog, {}, categoryEl, subfolderEl, {
    allowSuggestedRefresh: true,
    preferTemplate: true
  });

  assert.equal(subfolderEl.value, 'SDXL/style');
  assert.equal(saves.at(-1).subfolderSuggestionSource, 'template');
});

test('search suggestion metadata prefers exact matching base model over weaker archive result', () => {
  const getCachedSearchSuggestionData = eval(`(${extractMethod(downloadTargetMethodsSource, 'getCachedSearchSuggestionData')})`);
  const getFirstSearchResult = eval(`(${extractMethod(downloadTargetMethodsSource, 'getFirstSearchResult')})`);
  const getSearchSuggestionPreferredBaseModel = eval(`(${extractMethod(downloadTargetMethodsSource, 'getSearchSuggestionPreferredBaseModel')})`);
  const baseModelMatchesSearchSuggestionPreference = eval(`(${extractMethod(downloadTargetMethodsSource, 'baseModelMatchesSearchSuggestionPreference')})`);
  const getSearchSuggestionResultScore = eval(`(${extractMethod(downloadTargetMethodsSource, 'getSearchSuggestionResultScore')})`);
  const state = {
    selectedBaseModel: 'auto',
    results: {
      civitai: {
        base_model: 'Krea 2',
        tags: ['style'],
        filename: 'snofs_krea_v1.safetensors',
        name: 'Sex, Nudes, Other Fun Stuff (SNOFS)',
        match_type: 'exact',
        confidence: 100
      },
      lora_manager_archive: {
        base_model: 'SD 1.5',
        tags: ['concept'],
        filename: 'hyperpreg_v1.safetensors',
        name: 'hyperpreg',
        match_type: 'similar',
        confidence: 85
      }
    }
  };
  const dialog = {
    searchResultCache: new Map([['missing-key', state]]),
    getCachedSearchSuggestionData,
    getFirstSearchResult,
    getSearchSuggestionPreferredBaseModel,
    baseModelMatchesSearchSuggestionPreference,
    getSearchSuggestionResultScore,
    getMissingSearchKey() {
      return 'missing-key';
    },
    getMissingLocalBaseModel() {
      return 'Krea 2';
    },
    normalizeBaseModelToken(value = '') {
      return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
    },
    resolveBaseModelAlias(value = '') {
      const token = this.normalizeBaseModelToken(value);
      if (token === 'krea2') return 'Krea 2';
      if (token === 'sd15' || token === 'sd15' || token === 'sd1 5'.replace(/[^a-z0-9]+/g, '')) return 'SD 1.5';
      if (token === 'sd15' || token === 'sd15' || token === 'sd1.5'.replace(/[^a-z0-9]+/g, '')) return 'SD 1.5';
      return '';
    },
    resolveBaseModelAliasExact(value = '') {
      return this.resolveBaseModelAlias(value);
    },
    getSourceResultDownloadCategory() {
      return 'loras';
    }
  };

  const merged = getCachedSearchSuggestionData.call(dialog, {
    category: 'loras',
    civitai_search_result: { base_model: 'Krea 2' }
  });

  assert.equal(merged.base_model, 'Krea 2');
  assert.deepEqual(merged.tags, ['style']);
  assert.equal(merged.filename, 'snofs_krea_v1.safetensors');
});

test('download path metadata preserves source precedence and workflow fallbacks', () => {
  const getDownloadSourceContext = eval(`(${extractMethod(downloadTargetMethodsSource, 'getDownloadSourceContext')})`);
  const getDownloadPathMetadata = eval(`(${extractMethod(downloadTargetMethodsSource, 'getDownloadPathMetadata')})`);
  const dialog = {
    getDownloadSourceContext,
    getCachedSearchSuggestionData() {
      return {
        model_name: 'Cached model',
        tags: ['style'],
        repo_id: 'cached/repo',
        category: 'loras'
      };
    },
    getCompatibleCivitaiSearchResult() {
      return {
        base_model: 'SDXL',
        creator_username: 'workflow-author'
      };
    },
    getFilenameFromPath(value = '') {
      return String(value).split(/[\\/]/).at(-1) || '';
    }
  };

  const metadata = getDownloadPathMetadata.call(dialog, {
    original_path: 'workflow/model.safetensors',
    category: 'checkpoints',
    civitai_info: { model_name: 'Workflow model' },
    download_source: { model_name: 'Selected model' }
  }, {
    filename: 'explicit.safetensors',
    model_name: 'Explicit model',
    tags: ['explicit'],
    repo_id: 'owner/repo',
    author: 'explicit-author',
    category: 'text_encoders'
  });

  assert.equal(metadata.filename, 'explicit.safetensors');
  assert.equal(metadata.name, 'Explicit model');
  assert.equal(metadata.base_model, 'SDXL');
  assert.deepEqual(metadata.tags, ['explicit']);
  assert.equal(metadata.creator.username, 'workflow-author');
  assert.equal(metadata.author, 'explicit-author');
  assert.equal(metadata.repo_id, 'owner/repo');
  assert.equal(metadata.category, 'text_encoders');
});

test('manual URL download metadata never inherits provider identity or hash from search results', () => {
  const getDownloadSourceContext = eval(`(${extractMethod(downloadTargetMethodsSource, 'getDownloadSourceContext')})`);
  const getDownloadMetadata = eval(`(${extractMethod(downloadTargetMethodsSource, 'getDownloadMetadata')})`);
  const staleHash = 'a'.repeat(64);
  const exactHash = 'b'.repeat(64);
  const missing = {
    original_path: 'QWEN\\qwen3-vl-4b-heretic_int8.safetensors',
    category: 'text_encoders',
    civitai_info: {
      source: 'civarchive',
      model_id: 100,
      version_id: 200,
      sha256: staleHash,
      hashes: { SHA256: staleHash },
      civitai: { modelId: 100, id: 200 }
    },
    download_source: {
      source: 'civarchive',
      model_id: 100,
      version_id: 200,
      sha256: staleHash
    }
  };
  const source = {
    source: 'huggingface',
    details_source: 'huggingface',
    model_id: 'DreamFast/Qwen3-VL-4b-Heretic-ComfyUI',
    filename: 'qwen3-vl-4b-heretic_int8.safetensors',
    download_url: 'https://huggingface.co/DreamFast/repo/resolve/main/model.safetensors',
    version_url: 'https://huggingface.co/DreamFast/repo/blob/main/model.safetensors',
    provided_url: 'https://huggingface.co/DreamFast/repo/blob/main/model.safetensors',
    custom_url: true,
    url_source: 'custom',
    match_type: 'custom_url',
    sha256: exactHash,
    hashes: { SHA256: exactHash }
  };
  const dialog = {
    getDownloadSourceContext,
    getCachedSearchSuggestionData() {
      throw new Error('manual URL must not read cached search metadata');
    },
    getCompatibleCivitaiSearchResult() {
      throw new Error('manual URL must not read cached CivitAI metadata');
    },
    getFilenameFromPath(value = '') {
      return String(value).split(/[\\/]/).at(-1) || '';
    }
  };

  const metadata = getDownloadMetadata.call(dialog, missing, source, {
    filename: source.filename,
    category: 'text_encoders',
    url: source.download_url,
    openUrl: source.version_url,
    pathMetadata: {
      filename: source.filename,
      category: 'text_encoders'
    }
  });

  assert.equal(metadata.source, 'huggingface');
  assert.equal(metadata.model_id, 'DreamFast/Qwen3-VL-4b-Heretic-ComfyUI');
  assert.equal(metadata.version_id, '');
  assert.equal(metadata.sha256, exactHash);
  assert.deepEqual(metadata.hashes, { SHA256: exactHash });
  assert.equal(metadata.custom_url, true);
  assert.equal(metadata.url_source, 'custom');
  assert.equal(metadata.provided_url, source.provided_url);
  assert.equal('civitai' in metadata, false);
});

test('selected provider file hash overrides stale workflow hash', () => {
  const getDownloadSourceContext = eval(`(${extractMethod(downloadTargetMethodsSource, 'getDownloadSourceContext')})`);
  const getDownloadMetadata = eval(`(${extractMethod(downloadTargetMethodsSource, 'getDownloadMetadata')})`);
  const staleHash = '1'.repeat(64);
  const selectedHash = 'f'.repeat(64);
  const missing = {
    original_path: 'Other/CBS_novuschroma21 style.safetensors',
    category: 'loras',
    civitai_info: { sha256: staleHash, hashes: { SHA256: staleHash } },
    download_source: { source: 'civitai', sha256: staleHash }
  };
  const source = {
    source: 'lora_manager_archive',
    details_source: 'lora_manager_archive',
    model_id: 525933,
    version_id: 123,
    match_type: 'selected',
    filename: 'CBS_novuschroma21 style.safetensors',
    download_url: 'https://civitai.com/api/download/models/123',
    selected_file: {
      name: 'CBS_novuschroma21 style.safetensors',
      hashes: { SHA256: selectedHash }
    }
  };
  const dialog = {
    getDownloadSourceContext,
    getCachedSearchSuggestionData() {
      throw new Error('selected provider metadata must not read cached search metadata');
    },
    getCompatibleCivitaiSearchResult() {
      throw new Error('selected provider metadata must not read compatible search metadata');
    },
    getFilenameFromPath(value = '') {
      return String(value).split(/[\\/]/).at(-1) || '';
    }
  };

  const metadata = getDownloadMetadata.call(dialog, missing, source, {
    filename: source.filename,
    category: 'loras',
    url: source.download_url,
    pathMetadata: { filename: source.filename, category: 'loras' }
  });

  assert.equal(metadata.source, 'lora_manager_archive');
  assert.equal(metadata.sha256, selectedHash);
  assert.deepEqual(metadata.selected_file.hashes, { SHA256: selectedHash });
});

test('selected provider without a file hash does not inherit workflow hash', () => {
  const getDownloadSourceContext = eval(`(${extractMethod(downloadTargetMethodsSource, 'getDownloadSourceContext')})`);
  const getDownloadMetadata = eval(`(${extractMethod(downloadTargetMethodsSource, 'getDownloadMetadata')})`);
  const staleHash = '1'.repeat(64);
  const missing = {
    original_path: 'Other/another-variant.safetensors',
    category: 'loras',
    civitai_info: { sha256: staleHash },
    download_source: { source: 'civitai', sha256: staleHash }
  };
  const source = {
    source: 'lora_manager_archive',
    details_source: 'lora_manager_archive',
    match_type: 'selected',
    filename: 'another-variant.safetensors',
    download_url: 'https://civitai.com/api/download/models/456',
    selected_file: { name: 'another-variant.safetensors' }
  };
  const dialog = {
    getDownloadSourceContext,
    getCachedSearchSuggestionData() {
      throw new Error('selected provider metadata must not read cached search metadata');
    },
    getCompatibleCivitaiSearchResult() {
      throw new Error('selected provider metadata must not read compatible search metadata');
    },
    getFilenameFromPath(value = '') {
      return String(value).split(/[\\/]/).at(-1) || '';
    }
  };

  const metadata = getDownloadMetadata.call(dialog, missing, source, {
    filename: source.filename,
    category: 'loras',
    url: source.download_url,
    pathMetadata: { filename: source.filename, category: 'loras' }
  });

  assert.equal(metadata.sha256, '');
});

test('CivArchive metadata keeps its page URL when the download mirror is HuggingFace', () => {
  const getDownloadSourceContext = eval(`(${extractMethod(downloadTargetMethodsSource, 'getDownloadSourceContext')})`);
  const getDownloadMetadata = eval(`(${extractMethod(downloadTargetMethodsSource, 'getDownloadMetadata')})`);
  const civarchivePage = 'https://civarchive.com/models/123?modelVersionId=456';
  const huggingFaceMirror = 'https://huggingface.co/author/repo/resolve/main/model.safetensors';
  const source = {
    source: 'civarchive',
    details_source: 'civarchive',
    model_id: 123,
    version_id: 456,
    filename: 'model.safetensors',
    url: civarchivePage,
    version_url: 'https://huggingface.co/stale/repo/blob/main/model.safetensors',
    download_url: huggingFaceMirror
  };
  const dialog = {
    getDownloadSourceContext,
    getCachedSearchSuggestionData() {
      return {
        source: 'huggingface',
        version_url: 'https://huggingface.co/stale/repo/blob/main/model.safetensors'
      };
    },
    getCompatibleCivitaiSearchResult() {
      return {};
    },
    getFilenameFromPath(value = '') {
      return String(value).split(/[\\/]/).at(-1) || '';
    }
  };

  const metadata = getDownloadMetadata.call(dialog, {
    original_path: source.filename,
    category: 'checkpoints'
  }, source, {
    filename: source.filename,
    category: 'checkpoints',
    url: huggingFaceMirror,
    openUrl: '',
    pathMetadata: { filename: source.filename, category: 'checkpoints' }
  });

  assert.equal(metadata.source, 'civarchive');
  assert.equal(metadata.url, civarchivePage);
  assert.equal(metadata.version_url, civarchivePage);
  assert.equal(metadata.page_url, civarchivePage);
  assert.equal(metadata.download_url, huggingFaceMirror);
});

test('source link prefers the selected provider page over another provider mirror', () => {
  const getContextMenuSourceLink = eval(`(${extractMethod(modelInfoMethodsSource, 'getContextMenuSourceLink')})`);
  const civarchivePage = 'https://civarchive.com/models/123?modelVersionId=456';
  const dialog = {
    getContextMenuSourceKey() {
      return 'civarchive';
    },
    getContextMenuSourceUrlCandidates() {
      return [
        'https://huggingface.co/author/repo/blob/main/model.safetensors',
        civarchivePage
      ];
    },
    getContextMenuSourceKeyFromUrl(value = '') {
      if (value.includes('civarchive.com')) return 'civarchive';
      if (value.includes('huggingface.co')) return 'huggingface';
      return '';
    },
    normalizeContextMenuSourceUrl(value = '') {
      return value;
    },
    getContextMenuSourceConfig(key = '') {
      return { key, label: key === 'civarchive' ? 'CivArchive' : 'HuggingFace' };
    },
    buildContextMenuSourceUrlFromIds() {
      return '';
    }
  };

  const result = getContextMenuSourceLink.call(dialog, {});

  assert.equal(result.key, 'civarchive');
  assert.equal(result.label, 'CivArchive');
  assert.equal(result.url, civarchivePage);
});

test('manual URL table row preserves the explicit provenance boundary', () => {
  const getCustomUrlResultTableRow = eval(`(${extractMethod(searchPanelMethodsSource, 'getCustomUrlResultTableRow')})`);
  const result = {
    source: 'huggingface',
    model_id: 'DreamFast/Qwen3-VL-4b-Heretic-ComfyUI',
    filename: 'qwen3-vl-4b-heretic_int8.safetensors',
    download_url: 'https://huggingface.co/DreamFast/repo/resolve/main/model.safetensors',
    page_url: 'https://huggingface.co/DreamFast/repo/blob/main/model.safetensors',
    provided_url: 'https://huggingface.co/DreamFast/repo/blob/main/model.safetensors',
    custom_url: true
  };
  const dialog = {
    getFilenameFromPath(value = '') {
      return String(value).split(/[\\/]/).at(-1) || '';
    },
    getMissingDownloadCategory() {
      return 'text_encoders';
    },
    getSourceResultDownloadCategory() {
      return 'text_encoders';
    },
    getMissingModelKey() {
      return 'missing-key';
    },
    getLocalHashMatchIdentitiesForResult() {
      return [];
    },
    getHashMatchLabelForSearchResult() {
      return '';
    },
    getSearchResultMatchDisplay() {
      return { label: 'Provided', className: 'strong' };
    },
    formatSearchResultSize() {
      return '';
    },
    getSearchResultTimestamp() {
      return '';
    }
  };

  const row = getCustomUrlResultTableRow.call(dialog, {
    original_path: result.filename,
    category: 'text_encoders'
  }, result);

  assert.equal(row.detailsContext.custom_url, true);
  assert.equal(row.detailsContext.url_source, 'custom');
  assert.equal(row.detailsContext.provided_url, result.provided_url);
  assert.equal(row.detailsContext.source, 'huggingface');
});

test('source table rows preserve context-specific source labels', () => {
  const getDownloadSourceTableRow = eval(`(${extractMethod(searchPanelMethodsSource, 'getDownloadSourceTableRow')})`);
  const getCustomUrlResultTableRow = eval(`(${extractMethod(searchPanelMethodsSource, 'getCustomUrlResultTableRow')})`);
  const dialog = {
    getFilenameFromPath(value = '') {
      return String(value).split(/[\\/]/).at(-1) || '';
    },
    getSourceResultDownloadCategory() {
      return 'checkpoints';
    },
    getMissingDownloadCategory() {
      return 'checkpoints';
    },
    getModelVersionParts(name, version) {
      return { name, version };
    },
    getVersionedModelName(name, version) {
      return version ? `${name} ${version}` : name;
    },
    getDownloadPathMetadata() {
      return {};
    },
    getDownloadMetadata() {
      return {};
    },
    getLocalHashMatchIdentitiesForResult() {
      return [];
    },
    getHashMatchLabelForSearchResult() {
      return '';
    },
    getSearchResultMatchDisplay() {
      return { label: 'Known', className: 'strong' };
    },
    formatSearchResultSize() {
      return '';
    },
    getSearchResultTimestamp() {
      return '';
    },
    getMissingModelKey() {
      return 'missing-key';
    },
  };
  const missing = {
    original_path: 'model.safetensors',
    category: 'checkpoints',
    matches: [],
  };

  const providerRow = getDownloadSourceTableRow.call(dialog, missing, {
    source: 'civitai',
    url: 'https://example.test/download',
  });
  const workflowRow = getDownloadSourceTableRow.call(dialog, missing, {
    source: 'civitai',
    url: 'https://example.test/workflow-download',
    url_source: 'workflow',
  });
  const customRow = getCustomUrlResultTableRow.call(dialog, missing, {
    source: 'custom',
    download_url: 'https://example.test/custom-download',
  });

  assert.equal(providerRow.sourceLabel, 'CivitAI');
  assert.equal(workflowRow.sourceLabel, 'Workflow URL');
  assert.equal(customRow.sourceLabel, 'Custom URL');
});

test('search suggestion does not let a delayed incompatible result replace workflow path context', () => {
  const getCachedSearchSuggestionData = eval(`(${extractMethod(downloadTargetMethodsSource, 'getCachedSearchSuggestionData')})`);
  const getFirstSearchResult = eval(`(${extractMethod(downloadTargetMethodsSource, 'getFirstSearchResult')})`);
  const getSearchSuggestionPreferredBaseModel = eval(`(${extractMethod(downloadTargetMethodsSource, 'getSearchSuggestionPreferredBaseModel')})`);
  const baseModelMatchesSearchSuggestionPreference = eval(`(${extractMethod(downloadTargetMethodsSource, 'baseModelMatchesSearchSuggestionPreference')})`);
  const getCompatibleCivitaiSearchResult = eval(`(${extractMethod(downloadTargetMethodsSource, 'getCompatibleCivitaiSearchResult')})`);
  const getSearchSuggestionResultScore = eval(`(${extractMethod(downloadTargetMethodsSource, 'getSearchSuggestionResultScore')})`);
  const state = {
    selectedBaseModel: 'auto',
    results: {
      civitai: {
        base_model: 'Flux.1 D',
        filename: 'KNPV3_1.safetensors',
        match_type: 'similar',
        confidence: 80
      }
    }
  };
  const dialog = {
    searchResultCache: new Map([['missing-key', state]]),
    getCachedSearchSuggestionData,
    getFirstSearchResult,
    getSearchSuggestionPreferredBaseModel,
    baseModelMatchesSearchSuggestionPreference,
    getCompatibleCivitaiSearchResult,
    getSearchSuggestionResultScore,
    getMissingSearchKey() {
      return 'missing-key';
    },
    getSavedDownloadTargetSelection() {
      return null;
    },
    getMissingLocalBaseModel() {
      return '';
    },
    resolveBaseModelAliasFromPath(value = '') {
      return /(^|[\\/])KREA2([\\/]|$)/i.test(String(value)) ? 'Krea 2' : '';
    },
    normalizeBaseModelToken(value = '') {
      return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
    },
    resolveBaseModelAlias(value = '') {
      const token = this.normalizeBaseModelToken(value);
      if (token === 'krea2') return 'Krea 2';
      if (token === 'flux1d') return 'Flux.1 D';
      return '';
    },
    resolveBaseModelAliasExact(value = '') {
      return this.resolveBaseModelAlias(value);
    },
    getSourceResultDownloadCategory() {
      return 'loras';
    }
  };
  const missing = {
    category: 'loras',
    original_path: 'KREA2\\KNPV3_1.safetensors',
    civitai_search_result: { base_model: 'Flux.1 D' }
  };

  assert.equal(getSearchSuggestionPreferredBaseModel.call(dialog, missing), 'Krea 2');
  assert.deepEqual(getCompatibleCivitaiSearchResult.call(dialog, missing), {});
  assert.deepEqual(getCachedSearchSuggestionData.call(dialog, missing), {});
});

test('subfolder suggestion ignores hidden local matches below the visible confidence threshold', () => {
  const getSuggestedModelSubfolderCandidates = eval(`(${extractMethod(downloadTargetMethodsSource, 'getSuggestedModelSubfolderCandidates')})`);
  const getSuggestedExistingSubfolderByModelName = eval(`(${extractMethod(downloadTargetMethodsSource, 'getSuggestedExistingSubfolderByModelName')})`);
  const dialog = {
    getSuggestedModelSubfolderCandidates,
    getSuggestedExistingSubfolderByModelName,
    getBestLocalMatch(missing, minConfidence) {
      return (missing.matches || [])
        .filter(match => Number(match.confidence) >= minConfidence)
        .sort((a, b) => Number(b.confidence || 0) - Number(a.confidence || 0))[0] || null;
    },
    getCompatibleCivitaiSearchResult() {
      return {};
    },
    getCachedSearchSuggestionData() {
      return {};
    },
    normalizeFolderToken(value = '') {
      return String(value || '')
        .toLowerCase()
        .replace(/[\\/]+/g, ' ')
        .replace(/[^a-z0-9]+/g, '');
    }
  };
  const missing = {
    original_path: 'KNPV3_1.safetensors',
    name: 'KNPV3_1.safetensors',
    matches: [{
      confidence: 55,
      model: {
        filename: 'KNPV4.1_pre.safetensors',
        relative_path: 'FLUX\\KREA\\concept\\KNPV4.1_pre.safetensors'
      }
    }]
  };
  const folders = [{
    value: 'FLUX',
    segments: ['FLUX'],
    normalizedSegments: ['flux']
  }];

  const candidates = getSuggestedModelSubfolderCandidates.call(dialog, missing);
  const suggestion = getSuggestedExistingSubfolderByModelName.call(dialog, missing, folders);

  assert.equal(candidates.some(candidate => candidate.normalized === 'flux'), false);
  assert.equal(suggestion, null);
});

test('auto-link 100 percent applies visible exact matches without re-analyzing', async () => {
  const autoResolve100Percent = eval(`(${extractMethod(resolveDownloadMethodsSource, 'autoResolve100Percent')})`);
  const getExactLocalMatchSelections = eval(`(${extractMethod(resolveDownloadMethodsSource, 'getExactLocalMatchSelections')})`);
  const buildResolutionSelection = eval(`(${extractMethod(queueMethodsSource, 'buildResolutionSelection')})`);
  const getResolutionNodeRefs = eval(`(${extractMethod(queueMethodsSource, 'getResolutionNodeRefs')})`);
  const getResolutionQueueKey = eval(`(${extractMethod(queueMethodsSource, 'getResolutionQueueKey')})`);

  const exactModel = {
    path: 'E:/AI/models/checkpoints/exact.safetensors',
    filename: 'exact.safetensors',
    relative_path: 'exact.safetensors'
  };
  const missing = {
    node_id: 7,
    widget_index: 0,
    original_path: 'missing.safetensors',
    filename: 'missing.safetensors',
    category: 'checkpoints',
    matches: [{ confidence: 100, model: exactModel }]
  };
  const calls = [];
  const currentWorkflow = { nodes: [{ id: 7 }] };
  const updatedWorkflow = { nodes: [{ id: 7 }] };
  const dialog = {
    missingModels: [missing],
    cachedAnalysisData: null,
    cachedWorkflowSignature: 'current-signature',
    activeWorkflowSignature: 'current-signature',
    getExactLocalMatchSelections,
    buildResolutionSelection,
    getResolutionNodeRefs,
    getResolutionQueueKey,
    isVisible() {
      return true;
    },
    getCurrentWorkflow() {
      return currentWorkflow;
    },
    getWorkflowSignature(workflow) {
      assert.equal(workflow, currentWorkflow);
      return 'current-signature';
    },
    getBestLocalMatch(model, minConfidence) {
      return (model.matches || []).find(match => Number(match.confidence || 0) >= minConfidence) || null;
    },
    getMissingModelKey(model) {
      return `${model.node_id}:${model.widget_index}:${model.original_path}`;
    },
    getMissingSearchKey(model) {
      return `search:${model.original_path}`;
    },
    closeFooterMenus() {
      calls.push({ type: 'closeFooterMenus' });
    },
    async applyPendingResolutionList(list, options) {
      calls.push({ type: 'applyPendingResolutionList', list, options });
      return updatedWorkflow;
    },
    async fetchJson(url) {
      calls.push({ type: 'fetchJson', url });
      throw new Error('Auto-link should not analyze when current missing models are available');
    },
    showNotification(message, type) {
      calls.push({ type: 'notification', message, notificationType: type });
    }
  };

  const result = await autoResolve100Percent.call(dialog);
  const applyCall = calls.find(call => call.type === 'applyPendingResolutionList');

  assert.equal(result, updatedWorkflow);
  assert.ok(applyCall, 'Expected auto-link to delegate to applyPendingResolutionList');
  assert.equal(applyCall.list.length, 1);
  assert.equal(applyCall.list[0].resolved_path, exactModel.path);
  assert.deepEqual(applyCall.options, { clearAll: false });
  assert.equal(calls.some(call => call.type === 'fetchJson' && call.url === '/model_resolver/analyze'), false);
});

test('downloads tab shows active downloads from all workflow tabs', () => {
  const getActiveQueuePanelDownloads = eval(`(${extractMethod(queueMethodsSource, 'getActiveQueuePanelDownloads')})`);

  const dialog = {
    activeDownloads: {
      currentWorkflowDownload: {
        missing: { node_id: 7, widget_index: 0, original_path: 'current.safetensors', category: 'checkpoints' },
        workflowKey: '#workflow-a\nold-signature',
        workflowRouteKey: '#workflow-a',
      },
      otherWorkflowDownload: {
        missing: { node_id: 8, widget_index: 0, original_path: 'other.safetensors', category: 'loras' },
        workflowKey: '#workflow-b\nsignature',
        workflowRouteKey: '#workflow-b',
      },
      invalidEntryWithoutMissing: {
        workflowRouteKey: '#workflow-c',
      },
    },
    missingModels: [],
    activeWorkflowRouteKey: '#workflow-a',
    getActiveWorkflowRouteKey() {
      return '#workflow-a';
    },
    getWorkflowScopedQueueKey() {
      return '#workflow-a\nnew-signature-after-link';
    },
  };

  const downloads = getActiveQueuePanelDownloads.call(dialog);

  assert.deepEqual(downloads.map(download => download.downloadId), [
    'currentWorkflowDownload',
    'otherWorkflowDownload',
  ]);
});

test('browser refresh restores active backend downloads with their workflow context', async () => {
  const restoreActiveDownloadsFromBackend = eval(
    `(${extractMethod(resolveDownloadMethodsSource, 'restoreActiveDownloadsFromBackend')})`
  );
  const progress = {
    status: 'downloading',
    progress: 42,
    downloaded: 1024,
    total_size: 2048,
    filename: 'model.safetensors',
    path: 'vae/model.safetensors',
    directory: 'vae',
    url: 'https://huggingface.co/example/repo/resolve/main/model.safetensors',
    download_backend: 'huggingface_xet',
  };
  const polled = [];
  const removed = [];
  const dialog = {
    activeDownloads: {},
    _activeDownloadsRestorePromise: null,
    fetchJson: async endpoint => {
      assert.equal(endpoint, '/model_resolver/progress');
      return {
        'download-1': progress,
        'download-completed': { status: 'completed', filename: 'done.safetensors' },
      };
    },
    loadActiveDownloadRecovery() {
      return {
        'download-1': {
          missing: {
            missing_key: 'workflow-model-1',
            original_path: 'vae/original.safetensors',
            node_id: 7,
            widget_index: 0,
            category: 'vae',
          },
          workflowLabel: 'Video workflow',
          workflowRouteKey: '#video-workflow',
          sourceUrl: progress.url,
        },
        stale: { filename: 'stale.safetensors' },
      };
    },
    isDownloadProgressStatus(status) {
      return status === 'downloading';
    },
    rememberDownloadUiState(downloadId, info, nextProgress) {
      info.lastProgress = nextProgress;
      info.lastStatus = nextProgress.status;
      return { downloadId, progress: nextProgress };
    },
    persistActiveDownloadRecovery() {},
    removeActiveDownloadRecovery(downloadId) {
      removed.push(downloadId);
    },
    pollDownloadProgress(downloadId) {
      polled.push(downloadId);
    },
    rebindActiveDownloadMissingModels() {},
    updateDownloadAllButtonState() {},
    updateQueuePanel() {},
  };

  const restored = await restoreActiveDownloadsFromBackend.call(dialog);

  assert.equal(restored, 1);
  assert.deepEqual(polled, ['download-1']);
  assert.deepEqual(removed, ['stale']);
  assert.equal(dialog.activeDownloads['download-1'].missing.missing_key, 'workflow-model-1');
  assert.equal(dialog.activeDownloads['download-1'].workflowLabel, 'Video workflow');
  assert.equal(dialog.activeDownloads['download-1'].lastProgress.progress, 42);
});

test('downloads tab renders workflow label for active downloads', () => {
  const renderQueueDownloadsHtml = eval(`(${extractMethod(queueMethodsSource, 'renderQueueDownloadsHtml')})`);
  const getDownloadProgressPresentation = eval(
    `(${extractMethod(renderFormatMethodsSource, 'getDownloadProgressPresentation')})`
  );
  const dialog = {
    escapeHtml(value) {
      return String(value).replace(/[&<>\"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));
    },
    formatBytes(value) {
      return `${value} B`;
    },
    getCategoryDisplayName(value) {
      return value;
    },
    getDownloadWorkflowLabel(info) {
      return info.workflowLabel || 'Workflow B';
    },
    getDownloadFolderContext() {
      return null;
    },
    getDownloadDisplayProgress(progress) {
      return {
        percent: progress.progress || 0,
        downloaded: progress.downloaded || 0,
        totalSize: progress.total_size || 0,
        isFinalizing: false,
      };
    },
    getDownloadProgressPresentation(progress, options) {
      return getDownloadProgressPresentation.call(this, progress, options);
    },
    formatDownloadProgressMeta() {
      return '';
    },
    getDownloadQueueContext() {
      return null;
    },
  };

  const html = renderQueueDownloadsHtml.call(dialog, [{
    downloadId: 'download-1',
    info: {
      workflowLabel: 'Workflow B',
      missing: { node_id: 8, widget_index: 0, node_type: 'KSampler', category: 'loras' },
      lastProgress: { status: 'downloading', progress: 42, downloaded: 1024, total_size: 2048, filename: 'other.safetensors' },
    },
  }]);

  assert.match(html, /<span>Workflow<\/span>/);
  assert.match(html, /Workflow B/);
});

test('active download refresh preserves existing cards for hover and tooltip state', () => {
  const renderQueueDownloadsHtml = extractMethod(queueMethodsSource, 'renderQueueDownloadsHtml');

  assert.match(queueMethodsSource, /patchDownloadsPanelElement\(currentPanel, nextPanel\)/);
  assert.match(renderQueueDownloadsHtml, /data-download-id=/);
  assert.match(queueMethodsSource, /patchDownloadsPanelElement\(currentElement, nextElement\)/);
});

test('queue and download panel controls stay stable across repeated renders', () => {
  const renderQueuedSelections = extractMethod(queueMethodsSource, 'renderQueuedSelections');
  const patchQueuedSelections = extractMethod(queueMethodsSource, 'patchQueuedSelections');
  const wireDownloadsPanelControls = extractMethod(queueMethodsSource, 'wireDownloadsPanelControls');

  assert.match(renderQueuedSelections, /data-queue-key=/);
  assert.match(renderQueuedSelections, /patchQueuedSelections\(/);
  assert.match(patchQueuedSelections, /data\.queueKey|queueKey/);
  assert.match(wireDownloadsPanelControls, /\.mr-downloads-subtab[\s\S]*?button\._hasListener/);
  assert.match(wireDownloadsPanelControls, /clearHistoryButton\._hasListener/);
  assert.match(wireDownloadsPanelControls, /button\._hasListener/);
});

test('automatic opening for missing models is disabled by default', () => {
  const isAutoOpenEnabled = eval(`(${extractMethod(modelResolverSource, 'isAutoOpenEnabled')})`);
  const previousLocalStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const setStoredValue = value => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: { getItem: () => value },
    });
  };

  try {
    setStoredValue(null);
    assert.equal(isAutoOpenEnabled(), false);

    setStoredValue('false');
    assert.equal(isAutoOpenEnabled(), false);

    setStoredValue('true');
    assert.equal(isAutoOpenEnabled(), true);
  } finally {
    if (previousLocalStorageDescriptor) {
      Object.defineProperty(globalThis, 'localStorage', previousLocalStorageDescriptor);
    } else delete globalThis.localStorage;
  }
});

test('automatic opening remains conditional on unresolved models', () => {
  assert.match(
    modelResolverSource,
    /if \(data\.total_missing > 0\) \{[\s\S]*?this\.openResolverForDetectedMissingModels\(\);/
  );
  assert.match(optionsMethodsSource, /id="mr-options-auto-open-on-missing"/);
  assert.match(optionsMethodsSource, /auto_open_on_missing: Boolean\(autoOpenOnMissingInput\?\.checked\)/);
});

test('options credential checks preserve every endpoint contract', () => {
  const contracts = [
    ['/model_resolver/civitai/session-token/check', 'civitai_session_token', 'Paste token first'],
    ['/model_resolver/civitai/api-key/check', 'civitai_key', 'Paste API key first'],
    ['/model_resolver/huggingface/token/check', 'hf_token', 'Paste token first'],
    ['/model_resolver/brave/api-key/check', 'brave_search_api_key', 'Paste API key first']
  ];

  assert.match(optionsMethodsSource, /const checkCredential = async/);
  contracts.forEach(([endpoint, payloadKey, missingText]) => {
    assert.match(optionsMethodsSource, new RegExp(`endpoint: '${endpoint}'`));
    assert.match(optionsMethodsSource, new RegExp(`payloadKey: '${payloadKey}'`));
    assert.match(optionsMethodsSource, new RegExp(`missingText: '${missingText}'`));
  });
});

test('options display helpers use one shared summary and status update contract', () => {
  assert.match(optionsMethodsSource, /const setSummaryValue = \(element, value, mode = ''\)/);
  assert.match(optionsMethodsSource, /setSummaryValue\(metadataSizeScannedEl/);
  assert.match(optionsMethodsSource, /setSummaryValue\(metadataBuildScannedEl/);
  assert.doesNotMatch(optionsMethodsSource, /setMetadataSizeSummaryValue|setMetadataBuildSummaryValue/);
  assert.doesNotMatch(optionsMethodsSource, /setTokenCheckStatus|setAria2SummaryValue/);
  assert.match(optionsMethodsSource, /aria2StatusEl\.hidden = !text[\s\S]*?setElementStatusText\(aria2StatusEl, text, mode\)/);
});

test('automatic opening preserves the current resolver display mode', () => {
  const openResolverForDetectedMissingModels = eval(`(${extractMethod(modelResolverSource, 'openResolverForDetectedMissingModels')})`);
  const refreshReasons = [];
  let activationCount = 0;
  const visibleResolver = {
    dialog: {
      isVisible: () => true,
      scheduleActiveWorkflowRefresh: reason => refreshReasons.push(reason),
    },
    activateResolverButton() {
      activationCount += 1;
    },
  };

  openResolverForDetectedMissingModels.call(visibleResolver);
  assert.equal(activationCount, 0);
  assert.deepEqual(refreshReasons, ['auto-open-missing-models']);

  const hiddenResolver = {
    dialog: { isVisible: () => false },
    activateResolverButton() {
      activationCount += 1;
    },
  };
  openResolverForDetectedMissingModels.call(hiddenResolver);
  assert.equal(activationCount, 1);
});

test('active workflow label prefers selected ComfyUI workflow tab name over route hash', () => {
  const cleanWorkflowLabel = eval(`(${extractMethod(queueMethodsSource, 'cleanWorkflowLabel')})`);
  const getWorkflowLabelFromActiveTabElement = eval(`(${extractMethod(queueMethodsSource, 'getWorkflowLabelFromActiveTabElement')})`);
  const getWorkflowLabelFromRouteKey = eval(`(${extractMethod(queueMethodsSource, 'getWorkflowLabelFromRouteKey')})`);
  const getActiveWorkflowDownloadLabel = eval(`(${extractMethod(queueMethodsSource, 'getActiveWorkflowDownloadLabel')})`);

  const previousDocument = globalThis.document;
  const activeTab = {
    dataset: { workflowName: 'Real workflow name' },
    className: 'workflow-tab active',
    textContent: 'Wrong fallback text',
    closest(selector) {
      return selector.includes('#model-resolver-modal') ? null : null;
    },
    getAttribute(name) {
      return {
        'data-workflow-name': 'Real workflow name',
        title: 'Wrong title',
        'aria-label': 'Wrong aria',
        'data-workflow-id': 'wf-1',
        'data-tab-id': 'workflow-wf-1',
      }[name] || null;
    },
  };

  globalThis.document = {
    querySelectorAll(selector) {
      return selector === '[data-workflow-name][aria-selected="true"]' ? [activeTab] : [];
    },
  };

  try {
    const dialog = {
      activeWorkflowRouteKey: '#/workflow?workflow=technical-route-id',
      cleanWorkflowLabel,
      getWorkflowLabelFromComfyState() {
        return '';
      },
      findActiveWorkflowTabElement() {
        return { workflowLabel: 'Real workflow name' };
      },
      getWorkflowLabelFromActiveTabElement,
      getWorkflowLabelFromRouteKey,
      getActiveWorkflowRouteKey() {
        return '#/workflow?workflow=technical-route-id';
      },
    };

    assert.equal(getActiveWorkflowDownloadLabel.call(dialog), 'Real workflow name');
  } finally {
    globalThis.document = previousDocument;
  }
});

test('download workflow label parses workflow name from stored workflow URL instead of placeholder', () => {
  const cleanWorkflowLabel = eval(`(${extractMethod(queueMethodsSource, 'cleanWorkflowLabel')})`);
  const getWorkflowLabelFromRouteKey = eval(`(${extractMethod(queueMethodsSource, 'getWorkflowLabelFromRouteKey')})`);
  const getDownloadWorkflowLabel = eval(`(${extractMethod(queueMethodsSource, 'getDownloadWorkflowLabel')})`);

  const dialog = {
    cleanWorkflowLabel,
    getWorkflowLabelFromRouteKey,
    getActiveWorkflowDownloadLabel() {
      return 'Active fallback should not be used';
    },
  };

  assert.equal(
    getDownloadWorkflowLabel.call(dialog, {
      workflowKey: '#/workflow/2026-01-30-16-00-06-531854442295357_00001_\nmutable-signature',
    }),
    '2026-01-30-16-00-06-531854442295357_00001_'
  );
  assert.notEqual(
    getDownloadWorkflowLabel.call(dialog, { workflowKey: '#/workflow/2026-01-30-16-00-06-531854442295357_00001_\nmutable-signature' }),
    'Workflow from download start'
  );
});

test('new download entries store workflow metadata for display', () => {
  assert.match(
    resolveDownloadMethodsSource,
    /const workflowRouteKey = (workflowContext\.workflowRouteKey \|\| )?this\.getActiveWorkflowRouteKey\?\.\(\) \|\| this\.activeWorkflowRouteKey \|\| '';/
  );
  assert.match(
    resolveDownloadMethodsSource,
    /const workflowLabel = (workflowContext\.workflowLabel \|\| )?this\.getActiveWorkflowDownloadLabel\?\.\(\) \|\| 'Current workflow';/
  );
  assert.match(resolveDownloadMethodsSource, /workflowKey,\s*\r?\n\s*workflowRouteKey,\s*\r?\n\s*workflowLabel/);
  assert.match(resolveDownloadMethodsSource, /workflowLabel: info\.workflowLabel/);
});

test('local hash matches replace lower-confidence duplicate local matches', () => {
  const normalizeLocalMatchPathIdentity = eval(`(${extractMethod(resolveDownloadMethodsSource, 'normalizeLocalMatchPathIdentity')})`);
  const getLocalMatchAbsolutePathIdentity = eval(`(${extractMethod(resolveDownloadMethodsSource, 'getLocalMatchAbsolutePathIdentity')})`);
  const getLocalMatchRelativePathIdentity = eval(`(${extractMethod(resolveDownloadMethodsSource, 'getLocalMatchRelativePathIdentity')})`);
  const getLocalMatchIdentityKeys = eval(`(${extractMethod(resolveDownloadMethodsSource, 'getLocalMatchIdentityKeys')})`);
  const getLocalMatchIdentity = eval(`(${extractMethod(resolveDownloadMethodsSource, 'getLocalMatchIdentity')})`);
  const canMergeLocalMatches = eval(`(${extractMethod(resolveDownloadMethodsSource, 'canMergeLocalMatches')})`);
  const isHashLocalMatch = eval(`(${extractMethod(resolveDownloadMethodsSource, 'isHashLocalMatch')})`);
  const shouldReplaceLocalMatch = eval(`(${extractMethod(resolveDownloadMethodsSource, 'shouldReplaceLocalMatch')})`);
  const mergeLocalMatches = eval(`(${extractMethod(resolveDownloadMethodsSource, 'mergeLocalMatches')})`);

  const dialog = {
    normalizeLocalMatchPathIdentity,
    getLocalMatchAbsolutePathIdentity,
    getLocalMatchRelativePathIdentity,
    getLocalMatchIdentityKeys,
    getLocalMatchIdentity,
    canMergeLocalMatches,
    isHashLocalMatch,
    shouldReplaceLocalMatch,
  };
  const fuzzyMatch = {
    confidence: 87,
    match_type: 'fuzzy',
    model: {
      filename: 'same-model.safetensors',
      category: 'loras',
    },
  };
  const hashMatch = {
    confidence: 100,
    match_type: 'hash',
    hash_match: true,
    sha256: 'a'.repeat(64),
    model: {
      path: 'E:/Models/Loras/same-model.safetensors',
      relative_path: 'same-model.safetensors',
      filename: 'same-model.safetensors',
      category: 'loras',
    },
  };

  const merged = mergeLocalMatches.call(dialog, [fuzzyMatch], [hashMatch]);

  assert.equal(merged.length, 1);
  assert.equal(merged[0], hashMatch);
});

test('active download local match survives a temporarily empty refresh', () => {
  const preserveActiveDownloadLocalMatches = eval(`(${extractMethod(resolveDownloadMethodsSource, 'preserveActiveDownloadLocalMatches')})`);
  const downloadingMatch = {
    confidence: 100,
    filename: 'model.safetensors',
    model: {
      filename: 'model.safetensors',
      relative_path: 'ANIMA/model.safetensors',
      path: 'C:/models/loras/ANIMA/model.safetensors',
      category: 'loras'
    }
  };
  const activeMissing = { search_key: 'missing-1', matches: [downloadingMatch] };
  const staleMissing = { search_key: 'old-missing', matches: [] };
  const dialog = {
    preserveActiveDownloadLocalMatches,
    activeDownloads: {
      'download-1': { missing: staleMissing }
    },
    getActiveDownloadEntriesForMissing() {
      // A full workflow refresh may replace the missing-model object and change
      // its state key even though the local path still matches the download.
      return [];
    },
    getActiveDownloadInfoForLocalMatch(match) {
      return match === downloadingMatch
        ? { download_id: 'download-1', download_status: 'downloading' }
        : null;
    },
    cloneLocalMatches(matches) {
      return matches.map(match => ({ ...match, model: { ...(match.model || {}) } }));
    },
    mergeLocalMatches(existing, restored) {
      const byPath = new Map();
      [...existing, ...restored].forEach(match => {
        byPath.set(match.model?.relative_path || match.filename, match);
      });
      return [...byPath.values()];
    }
  };

  const matches = preserveActiveDownloadLocalMatches.call(dialog, activeMissing, []);

  assert.equal(matches.length, 1);
  assert.equal(matches[0].model.relative_path, 'ANIMA/model.safetensors');
  assert.equal(dialog.activeDownloads['download-1'].missing, activeMissing);
});

test('inactive local match is not preserved after an empty refresh', () => {
  const preserveActiveDownloadLocalMatches = eval(`(${extractMethod(resolveDownloadMethodsSource, 'preserveActiveDownloadLocalMatches')})`);
  const dialog = {
    preserveActiveDownloadLocalMatches,
    getActiveDownloadEntriesForMissing() {
      return [];
    }
  };

  const matches = preserveActiveDownloadLocalMatches.call(
    dialog,
    { matches: [{ confidence: 100, filename: 'old.safetensors' }] },
    []
  );

  assert.deepEqual(matches, []);
});

test('active download controls are scoped to the workflow that started them', () => {
  const getDownloadWorkflowScopeIdentity = eval(`(${extractMethod(resolveDownloadMethodsSource, 'getDownloadWorkflowScopeIdentity')})`);
  const getCurrentDownloadWorkflowScopeIdentity = eval(`(${extractMethod(resolveDownloadMethodsSource, 'getCurrentDownloadWorkflowScopeIdentity')})`);
  const isDownloadInCurrentWorkflowScope = eval(`(${extractMethod(resolveDownloadMethodsSource, 'isDownloadInCurrentWorkflowScope')})`);
  const getDownloadMissingIdentity = eval(`(${extractMethod(resolveDownloadMethodsSource, 'getDownloadMissingIdentity')})`);
  const getActiveDownloadEntryForMissing = eval(`(${extractMethod(resolveDownloadMethodsSource, 'getActiveDownloadEntryForMissing')})`);
  const missing = { search_key: 'shared-model' };
  const dialog = {
    getDownloadWorkflowScopeIdentity,
    getCurrentDownloadWorkflowScopeIdentity,
    isDownloadInCurrentWorkflowScope,
    getDownloadMissingIdentity,
    getActiveDownloadEntryForMissing,
    activeWorkflowRouteKey: '#workflow-a',
    activeDownloads: {
      'download-a': { missing, workflowRouteKey: '#workflow-a' },
      'download-b': { missing, workflowRouteKey: '#workflow-b' }
    },
    getActiveWorkflowTabContext() {
      return { workflowRouteKey: this.activeWorkflowRouteKey };
    },
    getActiveWorkflowRouteKey() {
      return this.activeWorkflowRouteKey;
    },
    getWorkflowScopedQueueKey() {
      return `${this.activeWorkflowRouteKey}\nsignature`;
    },
    getMissingSearchKey(value) {
      return value.search_key;
    },
    getMissingModelKey(value) {
      return value.search_key;
    }
  };

  assert.equal(getActiveDownloadEntryForMissing.call(dialog, missing).downloadId, 'download-a');
  dialog.activeWorkflowRouteKey = '#workflow-b';
  assert.equal(getActiveDownloadEntryForMissing.call(dialog, missing).downloadId, 'download-b');
});

test('download identity and progress slots stay separate for repeated custom-node coordinates', () => {
  const getDownloadMissingIdentity = eval(`(${extractMethod(resolveDownloadMethodsSource, 'getDownloadMissingIdentity')})`);
  const getDownloadProgressElementId = eval(`(${extractMethod(resolveDownloadMethodsSource, 'getDownloadProgressElementId')})`);
  const getActiveDownloadEntriesForMissing = eval(`(${extractMethod(resolveDownloadMethodsSource, 'getActiveDownloadEntriesForMissing')})`);
  const first = {
    node_id: 7,
    widget_index: 0,
    category: 'vae',
    original_path: 'MINIMAX/minimax_h3_audio_vae_fp32.safetensors',
  };
  const second = {
    node_id: 7,
    widget_index: 0,
    category: 'diffusion_models',
    original_path: 'MINIMAX/minimax_h3_fl2va_pruned_int8_converted.safetensors',
  };
  const dialog = {
    getDownloadMissingIdentity,
    getMissingModelKey(value) {
      return [value.node_id, value.widget_index, value.category, value.original_path].join(':');
    },
    getMissingSearchKey() {
      return 'shared-search-key';
    },
    getMissingModelDomKey(value) {
      return `model-${value.category}-${value.original_path}`;
    },
    isDownloadInCurrentWorkflowScope() {
      return true;
    },
    activeDownloads: {
      first: { missing: first },
      second: { missing: second },
    },
  };

  assert.notEqual(
    getDownloadMissingIdentity.call(dialog, first),
    getDownloadMissingIdentity.call(dialog, second)
  );
  assert.notEqual(
    getDownloadProgressElementId.call(dialog, first),
    getDownloadProgressElementId.call(dialog, second)
  );
  assert.deepEqual(
    getActiveDownloadEntriesForMissing.call(dialog, first).map(({ downloadId }) => downloadId),
    ['first']
  );
});

test('download snapshots with identical model keys remain separated by workflow', () => {
  const getDownloadWorkflowScopeIdentity = eval(`(${extractMethod(resolveDownloadMethodsSource, 'getDownloadWorkflowScopeIdentity')})`);
  const getCurrentDownloadWorkflowScopeIdentity = eval(`(${extractMethod(resolveDownloadMethodsSource, 'getCurrentDownloadWorkflowScopeIdentity')})`);
  const getDownloadMissingIdentity = eval(`(${extractMethod(resolveDownloadMethodsSource, 'getDownloadMissingIdentity')})`);
  const getDownloadStateKey = eval(`(${extractMethod(resolveDownloadMethodsSource, 'getDownloadStateKey')})`);
  const dialog = {
    getDownloadWorkflowScopeIdentity,
    getCurrentDownloadWorkflowScopeIdentity,
    getDownloadMissingIdentity,
    getDownloadStateKey,
    getMissingSearchKey(value) {
      return value.search_key;
    },
    getMissingModelKey(value) {
      return value.search_key;
    },
    getActiveWorkflowTabContext() {
      return { workflowRouteKey: '#workflow-current' };
    },
    getWorkflowScopedQueueKey() {
      return '#workflow-current\nsignature';
    }
  };
  const missing = { search_key: 'shared-model' };

  assert.notEqual(
    getDownloadStateKey.call(dialog, missing, { workflowRouteKey: '#workflow-a' }),
    getDownloadStateKey.call(dialog, missing, { workflowRouteKey: '#workflow-b' })
  );
});

test('pending cancelling state cannot be overwritten by stale downloading progress', () => {
  const applyPendingDownloadStatus = eval(`(${extractMethod(resolveDownloadMethodsSource, 'applyPendingDownloadStatus')})`);
  const info = {
    pendingDownloadStatus: 'cancelling',
    pendingDownloadStatusStartedAt: Date.now(),
    pendingDownloadStatusUntil: Date.now() + 30000
  };
  const dialog = {
    applyPendingDownloadStatus,
    clearPendingDownloadStatus(target) {
      delete target.pendingDownloadStatus;
    }
  };

  const progress = applyPendingDownloadStatus.call(dialog, info, {
    status: 'downloading',
    progress: 15,
    speed: 1024
  });

  assert.equal(progress.status, 'cancelling');
  assert.equal(progress.backend_status, 'downloading');
  assert.equal(progress.speed, 0);
});

test('progress polling explicitly handles cancelling as a non-interactive state', () => {
  assert.match(
    resolveDownloadMethodsSource,
    /else if \(progress\.status === 'cancelling'\)[\s\S]*?setTimeout\(\(\) => this\.pollDownloadProgress\(downloadId\), 500\)/
  );
  assert.match(
    resolveDownloadMethodsSource,
    /currentStatus === 'cancelling' \|\| currentStatus === 'cancelled'/
  );
});

test('Missing Models download progress preserves hovered controls between polling updates', () => {
  const renderDownloadSnapshot = extractMethod(
    resolveDownloadMethodsSource,
    'renderDownloadSnapshot'
  );
  const renderDownloadProgressGroupForMissing = extractMethod(
    resolveDownloadMethodsSource,
    'renderDownloadProgressGroupForMissing'
  );
  const patchDownloadProgressContent = extractMethod(
    resolveDownloadMethodsSource,
    'patchDownloadProgressContent'
  );
  const pollDownloadProgress = extractMethod(
    resolveDownloadMethodsSource,
    'pollDownloadProgress'
  );

  assert.match(renderDownloadSnapshot, /patchDownloadProgressContent\(/);
  assert.doesNotMatch(renderDownloadSnapshot, /progressDiv\.innerHTML\s*=/);
  assert.match(renderDownloadProgressGroupForMissing, /patchDownloadProgressContent\(/);
  assert.doesNotMatch(renderDownloadProgressGroupForMissing, /progressDiv\.innerHTML\s*=/);
  assert.match(
    patchDownloadProgressContent,
    /patchDownloadsPanelElement\(progressDiv,\s*nextProgressDiv\)/
  );

  const activeProgressBranch = pollDownloadProgress.match(
    /if \(progress\.status === 'downloading'[\s\S]*?\} else if \(progress\.status === 'cancelling'\)/
  )?.[0] || '';
  const cancellingBranch = pollDownloadProgress.match(
    /else if \(progress\.status === 'cancelling'\)[\s\S]*?\} else if \(progress\.status === 'completed'\)/
  )?.[0] || '';
  assert.ok(activeProgressBranch);
  assert.ok(cancellingBranch);
  assert.doesNotMatch(activeProgressBranch, /refreshLocalMatchesUiForMissing/);
  assert.doesNotMatch(cancellingBranch, /refreshLocalMatchesUiForMissing/);
});

test('native Xet progress polling refreshes every 200 milliseconds', () => {
  const getDownloadProgressPollDelay = eval(`(${extractMethod(downloadProgressMethodsSource, 'getDownloadProgressPollDelay')})`);

  assert.equal(getDownloadProgressPollDelay({ status: 'downloading', download_backend: 'huggingface_xet' }), 200);
  assert.equal(getDownloadProgressPollDelay({ status: 'downloading', download_backend: 'aria2' }), 1000);
  assert.equal(getDownloadProgressPollDelay({ status: 'paused', download_backend: 'huggingface_xet' }), 1500);
});

test('active download folder context opens the existing directory before the target file exists', () => {
  const getDownloadFolderContext = eval(`(${extractMethod(resolveDownloadMethodsSource, 'getDownloadFolderContext')})`);
  const directory = 'E:\\ComfyUI\\models\\text_encoders\\QWEN\\test';
  const filePath = `${directory}\\model.safetensors`;
  const context = getDownloadFolderContext.call({}, {
    directory,
    path: filePath,
    filename: 'model.safetensors'
  }, {});

  assert.equal(context.open_path, directory);
  assert.equal(context.folder_path, directory);
  assert.equal(context.download_path, filePath);
});

test('local download match predicate covers absolute, relative, and optional snapshot identities', () => {
  const match = {
    model: {
      path: 'C:/models/diffusion_models/ANIMA/test/anima_baseV10.safetensors',
      relative_path: 'ANIMA/test/anima_baseV10.safetensors',
      filename: 'anima_baseV10.safetensors'
    }
  };
  const info = {
    filename: 'anima_baseV10.safetensors',
    subfolder: 'ANIMA/test',
    downloadPath: 'C:/models/diffusion_models/ANIMA/test/anima_baseV10.safetensors',
    downloadDirectory: 'C:/models/diffusion_models/ANIMA/test'
  };
  const progress = {
    filename: 'anima_baseV10.safetensors',
    path: info.downloadPath,
    relative_path: 'ANIMA/test/anima_baseV10.safetensors'
  };

  assert.equal(matchesLocalModelDownload(match, { info, progress }), true);
  assert.equal(matchesLocalModelDownload({ model: { relative_path: 'ANIMA/other/model.safetensors' } }, { info, progress }), false);

  const snapshot = {
    downloadPath: 'C:/models/diffusion_models/ANIMA/test/anima_baseV10.safetensors',
    downloadDirectory: 'C:/models/diffusion_models/ANIMA/test'
  };
  assert.equal(
    matchesLocalModelDownload(match, {
      info: { filename: info.filename },
      progress: {},
      statusSnapshot: snapshot,
      includeStatusSnapshot: true
    }),
    true
  );
  assert.equal(
    matchesLocalModelDownload(match, {
      info: { filename: info.filename },
      progress: {},
      statusSnapshot: snapshot
    }),
    false
  );
});

test('cancelled download removes only its path-specific local match', () => {
  const normalizeLocalMatchPathIdentity = eval(`(${extractMethod(resolveDownloadMethodsSource, 'normalizeLocalMatchPathIdentity')})`);
  const isLocalMatchForDownloadTarget = eval(`(${extractMethod(resolveDownloadMethodsSource, 'isLocalMatchForDownloadTarget')})`);
  const removeCancelledDownloadLocalMatches = eval(`(${extractMethod(resolveDownloadMethodsSource, 'removeCancelledDownloadLocalMatches')})`);
  const makeMatch = relativePath => ({
    confidence: 100,
    model: {
      path: `C:/models/diffusion_models/${relativePath}`,
      relative_path: relativePath,
      filename: 'anima_baseV10.safetensors',
      category: 'diffusion_models'
    }
  });
  const existingMatch = makeMatch('ANIMA/anime/anima_baseV10.safetensors');
  const cancelledMatch = makeMatch('ANIMA/test/anima_baseV10.safetensors');
  const missing = { matches: [existingMatch, cancelledMatch] };
  const cachedMissing = { matches: [existingMatch, cancelledMatch] };
  const info = {
    missing,
    filename: 'anima_baseV10.safetensors',
    subfolder: 'ANIMA/test',
    downloadPath: 'C:/models/diffusion_models/ANIMA/test/anima_baseV10.safetensors'
  };
  const dialog = {
    normalizeLocalMatchPathIdentity,
    isLocalMatchForDownloadTarget,
    removeCancelledDownloadLocalMatches,
    missingModels: [missing],
    cachedAnalysisData: { missing_models: [cachedMissing], resolved_models: [] },
    workflowAnalysisCaches: new Map(),
    getDownloadProgressStore() {
      return new Map();
    }
  };

  removeCancelledDownloadLocalMatches.call(dialog, info, {
    status: 'cancelled',
    filename: info.filename,
    path: info.downloadPath
  });

  assert.deepEqual(missing.matches, [existingMatch]);
  assert.deepEqual(cachedMissing.matches, [existingMatch]);
});

test('successful cancel removes active download and keeps terminal info in every workflow snapshot', () => {
  const finalizeCancelledDownloadFrontend = eval(`(${extractMethod(resolveDownloadMethodsSource, 'finalizeCancelledDownloadFrontend')})`);
  const progressDiv = {
    innerHTML: '<progress></progress>',
    isConnected: true,
    classList: {
      added: [],
      removed: [],
      add(value) { this.added.push(value); },
      remove(value) { this.removed.push(value); }
    }
  };
  const info = { missing: { matches: [] }, progressDiv };
  const progressStore = new Map([
    ['workflow-a::model', { downloadId: 'download-1', status: 'downloading' }],
    ['workflow-b::model', { downloadId: 'download-1', status: 'downloading' }],
    ['workflow-b::other', { downloadId: 'download-2', status: 'downloading' }]
  ]);
  const dialog = {
    finalizeCancelledDownloadFrontend,
    activeDownloads: { 'download-1': info, 'download-2': {} },
    clearPendingDownloadStatus() {},
    removeCancelledDownloadLocalMatches() {},
    getDownloadProgressStore() { return progressStore; },
    resolveDownloadUiElements() { return { progressDiv, downloadBtn: null }; },
    renderDownloadSnapshot(_downloadId, snapshot) {
      this.renderedSnapshot = snapshot;
      progressDiv.innerHTML = snapshot.message;
    },
    refreshLocalMatchesUiForMissing() {},
    updateDownloadAllButtonState() {},
    updateQueuePanel() {}
  };

  finalizeCancelledDownloadFrontend.call(dialog, 'download-1', info, { status: 'cancelled' });

  assert.equal(dialog.activeDownloads['download-1'], undefined);
  assert.ok(dialog.activeDownloads['download-2']);
  assert.equal(progressStore.get('workflow-a::model').status, 'cancelled');
  assert.equal(progressStore.get('workflow-b::model').status, 'cancelled');
  assert.equal(progressStore.get('workflow-a::model').isActive, false);
  assert.equal(progressStore.get('workflow-b::model').progress.status, 'cancelled');
  assert.equal(progressStore.has('workflow-b::other'), true);
  assert.equal(dialog.renderedSnapshot.status, 'cancelled');
  assert.match(progressDiv.innerHTML, /Download cancelled/);
});

test('stale polling response cannot recreate a finalized cancelled download', () => {
  assert.match(
    resolveDownloadMethodsSource,
    /if \(this\.activeDownloads\?\.\[downloadId\] !== info\) return;/
  );
});

test('local hash matches win over exact matches for the same model identity', () => {
  const normalizeLocalMatchPathIdentity = eval(`(${extractMethod(resolveDownloadMethodsSource, 'normalizeLocalMatchPathIdentity')})`);
  const getLocalMatchAbsolutePathIdentity = eval(`(${extractMethod(resolveDownloadMethodsSource, 'getLocalMatchAbsolutePathIdentity')})`);
  const getLocalMatchRelativePathIdentity = eval(`(${extractMethod(resolveDownloadMethodsSource, 'getLocalMatchRelativePathIdentity')})`);
  const getLocalMatchIdentityKeys = eval(`(${extractMethod(resolveDownloadMethodsSource, 'getLocalMatchIdentityKeys')})`);
  const getLocalMatchIdentity = eval(`(${extractMethod(resolveDownloadMethodsSource, 'getLocalMatchIdentity')})`);
  const canMergeLocalMatches = eval(`(${extractMethod(resolveDownloadMethodsSource, 'canMergeLocalMatches')})`);
  const isHashLocalMatch = eval(`(${extractMethod(resolveDownloadMethodsSource, 'isHashLocalMatch')})`);
  const shouldReplaceLocalMatch = eval(`(${extractMethod(resolveDownloadMethodsSource, 'shouldReplaceLocalMatch')})`);
  const mergeLocalMatches = eval(`(${extractMethod(resolveDownloadMethodsSource, 'mergeLocalMatches')})`);

  const dialog = {
    normalizeLocalMatchPathIdentity,
    getLocalMatchAbsolutePathIdentity,
    getLocalMatchRelativePathIdentity,
    getLocalMatchIdentityKeys,
    getLocalMatchIdentity,
    canMergeLocalMatches,
    isHashLocalMatch,
    shouldReplaceLocalMatch,
  };
  const exactMatch = {
    confidence: 100,
    match_type: 'exact',
    model: {
      path: 'E:\\Models\\Checkpoints\\same-model.safetensors',
      filename: 'same-model.safetensors',
      category: 'checkpoints',
    },
  };
  const hashMatch = {
    confidence: 100,
    match_type: 'hash',
    hash_match: true,
    model: {
      path: 'E:/Models/Checkpoints/same-model.safetensors',
      filename: 'same-model.safetensors',
      category: 'checkpoints',
    },
  };

  const merged = mergeLocalMatches.call(dialog, [exactMatch], [hashMatch]);

  assert.equal(merged.length, 1);
  assert.equal(merged[0], hashMatch);
});

test('filename-only hash result does not replace a path-specific active download match', () => {
  const normalizeLocalMatchPathIdentity = eval(`(${extractMethod(resolveDownloadMethodsSource, 'normalizeLocalMatchPathIdentity')})`);
  const getLocalMatchAbsolutePathIdentity = eval(`(${extractMethod(resolveDownloadMethodsSource, 'getLocalMatchAbsolutePathIdentity')})`);
  const getLocalMatchRelativePathIdentity = eval(`(${extractMethod(resolveDownloadMethodsSource, 'getLocalMatchRelativePathIdentity')})`);
  const getLocalMatchIdentityKeys = eval(`(${extractMethod(resolveDownloadMethodsSource, 'getLocalMatchIdentityKeys')})`);
  const canMergeLocalMatches = eval(`(${extractMethod(resolveDownloadMethodsSource, 'canMergeLocalMatches')})`);
  const isHashLocalMatch = eval(`(${extractMethod(resolveDownloadMethodsSource, 'isHashLocalMatch')})`);
  const shouldReplaceLocalMatch = eval(`(${extractMethod(resolveDownloadMethodsSource, 'shouldReplaceLocalMatch')})`);
  const mergeLocalMatches = eval(`(${extractMethod(resolveDownloadMethodsSource, 'mergeLocalMatches')})`);
  const dialog = {
    normalizeLocalMatchPathIdentity,
    getLocalMatchAbsolutePathIdentity,
    getLocalMatchRelativePathIdentity,
    getLocalMatchIdentityKeys,
    canMergeLocalMatches,
    isHashLocalMatch,
    shouldReplaceLocalMatch,
    getActiveDownloadInfoForLocalMatch(match) {
      return match.downloading
        ? { download_id: 'download-1', download_status: 'downloading' }
        : null;
    }
  };
  const knownHashMatch = {
    confidence: 100,
    match_type: 'hash',
    hash_match: true,
    model: {
      path: 'C:/models/diffusion_models/ANIMA/anime/anima_baseV10.safetensors',
      relative_path: 'ANIMA/anime/anima_baseV10.safetensors',
      filename: 'anima_baseV10.safetensors',
      category: 'diffusion_models'
    }
  };
  const downloadingExactMatch = {
    confidence: 100,
    match_type: 'exact',
    downloading: true,
    model: {
      path: 'C:/models/diffusion_models/ANIMA/test/anima_baseV10.safetensors',
      relative_path: 'ANIMA/test/anima_baseV10.safetensors',
      filename: 'anima_baseV10.safetensors',
      category: 'diffusion_models'
    }
  };
  const lateFilenameOnlyHash = {
    confidence: 100,
    match_type: 'hash',
    hash_match: true,
    sha256: 'b'.repeat(64),
    model: {
      filename: 'anima_baseV10.safetensors',
      category: 'diffusion_models'
    }
  };

  const merged = mergeLocalMatches.call(
    dialog,
    [knownHashMatch, downloadingExactMatch],
    [lateFilenameOnlyHash]
  );

  assert.equal(merged.length, 2);
  assert.ok(merged.includes(knownHashMatch));
  assert.ok(merged.includes(downloadingExactMatch));
});

test('local match merge keeps same filename in different folders separate', () => {
  const normalizeLocalMatchPathIdentity = eval(`(${extractMethod(resolveDownloadMethodsSource, 'normalizeLocalMatchPathIdentity')})`);
  const getLocalMatchAbsolutePathIdentity = eval(`(${extractMethod(resolveDownloadMethodsSource, 'getLocalMatchAbsolutePathIdentity')})`);
  const getLocalMatchRelativePathIdentity = eval(`(${extractMethod(resolveDownloadMethodsSource, 'getLocalMatchRelativePathIdentity')})`);
  const getLocalMatchIdentityKeys = eval(`(${extractMethod(resolveDownloadMethodsSource, 'getLocalMatchIdentityKeys')})`);
  const getLocalMatchIdentity = eval(`(${extractMethod(resolveDownloadMethodsSource, 'getLocalMatchIdentity')})`);
  const canMergeLocalMatches = eval(`(${extractMethod(resolveDownloadMethodsSource, 'canMergeLocalMatches')})`);
  const isHashLocalMatch = eval(`(${extractMethod(resolveDownloadMethodsSource, 'isHashLocalMatch')})`);
  const shouldReplaceLocalMatch = eval(`(${extractMethod(resolveDownloadMethodsSource, 'shouldReplaceLocalMatch')})`);
  const mergeLocalMatches = eval(`(${extractMethod(resolveDownloadMethodsSource, 'mergeLocalMatches')})`);

  const dialog = {
    normalizeLocalMatchPathIdentity,
    getLocalMatchAbsolutePathIdentity,
    getLocalMatchRelativePathIdentity,
    getLocalMatchIdentityKeys,
    getLocalMatchIdentity,
    canMergeLocalMatches,
    isHashLocalMatch,
    shouldReplaceLocalMatch,
  };
  const firstMatch = {
    confidence: 100,
    match_type: 'exact',
    model: {
      path: 'E:/Models/A/shared-name.safetensors',
      filename: 'shared-name.safetensors',
      category: 'loras',
    },
  };
  const secondMatch = {
    confidence: 100,
    match_type: 'hash',
    hash_match: true,
    model: {
      path: 'E:/Models/B/shared-name.safetensors',
      filename: 'shared-name.safetensors',
      category: 'loras',
    },
  };

  const merged = mergeLocalMatches.call(dialog, [firstMatch], [secondMatch]);

  assert.equal(merged.length, 2);
});

test('local match status labels hash matches distinctly from exact matches', () => {
  const renderLocalMatchStatus = eval(`(${extractMethod(searchPanelMethodsSource, 'renderLocalMatchStatus')})`);
  const sha256 = 'c'.repeat(64);
  const hashLabelMap = new Map([[sha256, 'Hash 2']]);

  assert.match(
    renderLocalMatchStatus({ confidence: 100, match_type: 'hash', hash_match: true }),
    /mr-match-status-hash[^>]*>Hash</
  );
  assert.match(
    renderLocalMatchStatus({ confidence: 100, match_type: 'hash', hash_match: true, sha256 }, hashLabelMap),
    /mr-match-status-hash[^>]*>Hash 2</
  );
  assert.match(
    renderLocalMatchStatus({ confidence: 100, match_type: 'hash', hash_match: true }),
    /tabindex="0"/
  );
  assert.match(
    renderLocalMatchStatus({ confidence: 100, match_type: 'exact' }),
    /mr-match-status-exact[^>]*>Exact</
  );
});

test('local match refreshes preserve keyed rows and button handlers', () => {
  const renderLocalMatchesContent = extractMethod(searchPanelMethodsSource, 'renderLocalMatchesContent');
  const renderLocalMatchRow = extractMethod(searchPanelMethodsSource, 'renderLocalMatchRow');
  const patchLocalMatchesContainer = extractMethod(
    resolveDownloadMethodsSource,
    'patchLocalMatchesContainer'
  );
  const refreshLocalMatchesUiForMissing = extractMethod(
    resolveDownloadMethodsSource,
    'refreshLocalMatchesUiForMissing'
  );
  const wireLocalMatchButtons = extractMethod(searchPanelMethodsSource, 'wireLocalMatchButtons');
  const refreshMissingListRow = extractMethod(missingBrowserMethodsSource, 'refreshMissingListRow');

  assert.match(renderLocalMatchesContent, /renderLocalMatchRow/);
  assert.match(renderLocalMatchRow, /data-local-match-key/);
  assert.match(renderLocalMatchRow, /encodeURIComponent/);
  assert.match(patchLocalMatchesContainer, /local-match-key|localMatchKey/);
  assert.match(patchLocalMatchesContainer, /mr-local-alternatives-toggle/);
  assert.match(refreshLocalMatchesUiForMissing, /patchLocalMatchesContainer/);
  assert.doesNotMatch(refreshLocalMatchesUiForMissing, /body\.innerHTML\s*=/);
  assert.doesNotMatch(refreshLocalMatchesUiForMissing, /wireLocalMatchButtons/);
  assert.match(wireLocalMatchButtons, /bindEventOnce/);
  assert.match(wireLocalMatchButtons, /local-match-actions/);
  assert.doesNotMatch(wireLocalMatchButtons, /\.onclick\s*=/);
  assert.doesNotMatch(wireLocalMatchButtons, /addEventListener\('click'/);
  assert.match(refreshMissingListRow, /renderedSources/);
  assert.match(refreshMissingListRow, /innerHTML !== renderedSources/);
});

test('local match rows preserve best-match and alternative rendering contracts', () => {
  globalThis.getSvgIcon = () => '<svg></svg>';
  const renderLocalMatchRow = eval(`(${extractMethod(searchPanelMethodsSource, 'renderLocalMatchRow')})`);
  const renderLocalMatchesContent = eval(`(${extractMethod(searchPanelMethodsSource, 'renderLocalMatchesContent')})`);
  const dialog = {
    renderLocalMatchRow,
    getHashMatchLabelMap() {
      return null;
    },
    buildContextMenuModelData() {
      return { model: 'context' };
    },
    getLocalMatchContextData() {
      return { source: 'local' };
    },
    getLocalMatchIdentity(match) {
      return match.identity;
    },
    escapeHtml(value) {
      return String(value).replace(/[&<>"']/g, char => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      }[char]));
    },
    getContextMenuAttrs() {
      return ' data-context-menu="true"';
    },
    getConfidenceBadge(confidence) {
      return `<span class="confidence">${confidence}</span>`;
    },
    getModelPreviewTooltipAttrs() {
      return '';
    },
    renderLocalMatchStatusGroup() {
      return '<span class="status-group">Status</span>';
    },
    areLocalMatchAlternativesCollapsed() {
      return false;
    },
  };
  const html = renderLocalMatchesContent.call(dialog, {
    node_id: 1,
    widget_index: 2,
    matches: [
      {
        confidence: 100,
        identity: 'path:/models/best.safetensors',
        model: { relative_path: 'models/best.safetensors' },
      },
      {
        confidence: 80,
        identity: 'path:/models/alternative.safetensors',
        model: { relative_path: 'models/alternative.safetensors' },
      },
    ],
  }, 0);

  assert.match(html, /class="mr-match-row mr-best-match"/);
  assert.match(html, /id="resolve-0-1-2-0"/);
  assert.match(html, /data-local-match-key="path%3A%2Fmodels%2Fbest\.safetensors"/);
  assert.match(html, /data-context-menu="true"/g);
  assert.match(html, /data-local-match-alternative="true"/);
  assert.match(html, /id="resolve-alt-0-1-2-0"/);
  assert.match(html, /data-local-match-key="path%3A%2Fmodels%2Falternative\.safetensors"/);
  assert.equal((html.match(/class="status-group"/g) || []).length, 2);
});

test('local match classification preserves the confidence threshold and alternative partition', () => {
  globalThis.getSvgIcon = () => '<svg></svg>';
  const renderLocalMatchRow = eval(`(${extractMethod(searchPanelMethodsSource, 'renderLocalMatchRow')})`);
  const renderLocalMatchesContent = eval(`(${extractMethod(searchPanelMethodsSource, 'renderLocalMatchesContent')})`);
  const dialog = {
    renderLocalMatchRow,
    getHashMatchLabelMap() {
      return null;
    },
    buildContextMenuModelData() {
      return { model: 'context' };
    },
    getLocalMatchContextData() {
      return { source: 'local' };
    },
    getLocalMatchIdentity(match) {
      return match.identity;
    },
    escapeHtml(value) {
      return String(value).replace(/[&<>"']/g, char => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      }[char]));
    },
    getContextMenuAttrs() {
      return '';
    },
    getConfidenceBadge(confidence) {
      return `<span class="confidence">${confidence}</span>`;
    },
    getModelPreviewTooltipAttrs() {
      return '';
    },
    renderLocalMatchStatusGroup() {
      return '';
    },
    areLocalMatchAlternativesCollapsed() {
      return false;
    },
  };
  const html = renderLocalMatchesContent.call(dialog, {
    node_id: 1,
    widget_index: 2,
    matches: [
      { confidence: 69, identity: 'below-threshold', model: { relative_path: 'below.safetensors' } },
      { confidence: 70, identity: 'minimum-threshold', model: { relative_path: 'minimum.safetensors' } },
      { confidence: 80, identity: 'alternative', model: { relative_path: 'alternative.safetensors' } },
      { confidence: 100, identity: 'perfect', model: { relative_path: 'perfect.safetensors' } },
    ],
  }, 0);

  assert.match(html, /perfect\.safetensors/);
  assert.match(html, /minimum\.safetensors/);
  assert.match(html, /alternative\.safetensors/);
  assert.doesNotMatch(html, /below\.safetensors/);
  assert.match(html, /Alternatives \(2\)/);
});

test('local match classification limits visible non-perfect matches to the five highest confidences', () => {
  globalThis.getSvgIcon = () => '<svg></svg>';
  const renderLocalMatchRow = eval(`(${extractMethod(searchPanelMethodsSource, 'renderLocalMatchRow')})`);
  const renderLocalMatchesContent = eval(`(${extractMethod(searchPanelMethodsSource, 'renderLocalMatchesContent')})`);
  const dialog = {
    renderLocalMatchRow,
    getHashMatchLabelMap() {
      return null;
    },
    buildContextMenuModelData() {
      return { model: 'context' };
    },
    getLocalMatchContextData() {
      return { source: 'local' };
    },
    getLocalMatchIdentity(match) {
      return match.identity;
    },
    escapeHtml(value) {
      return String(value).replace(/[&<>"']/g, char => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      }[char]));
    },
    getContextMenuAttrs() {
      return '';
    },
    getConfidenceBadge(confidence) {
      return `<span class="confidence">${confidence}</span>`;
    },
    getModelPreviewTooltipAttrs() {
      return '';
    },
    renderLocalMatchStatusGroup() {
      return '';
    },
    areLocalMatchAlternativesCollapsed() {
      return false;
    },
  };
  const html = renderLocalMatchesContent.call(dialog, {
    node_id: 1,
    widget_index: 2,
    matches: [
      { confidence: 69, identity: 'below-threshold', model: { relative_path: 'below.safetensors' } },
      ...[70, 75, 80, 85, 90, 95].map(confidence => ({
        confidence,
        identity: `match-${confidence}`,
        model: { relative_path: `match-${confidence}.safetensors` },
      })),
    ],
  }, 0);

  assert.match(html, /match-95\.safetensors/);
  assert.match(html, /match-75\.safetensors/);
  assert.doesNotMatch(html, /match-70\.safetensors/);
  assert.doesNotMatch(html, /below\.safetensors/);
  assert.equal((html.match(/class="mr-match-row/g) || []).length, 5);
});

test('URN resolution preserves the download panel container', () => {
  const resolveUrnAsync = extractMethod(resolveDownloadMethodsSource, 'resolveUrnAsync');

  assert.doesNotMatch(resolveUrnAsync, /downloadEl\.outerHTML\s*=/);
  assert.match(resolveUrnAsync, /downloadEl\.innerHTML\s*=\s*this\.renderKnownDownloadPanel/);
  assert.match(resolveUrnAsync, /wireDownloadSearchPanel\(downloadEl, missing\)/);
});

test('search and URN completion ignore stale UI runs', () => {
  const searchStart = resolveDownloadMethodsSource.indexOf('async searchOnline');
  const urnStart = resolveDownloadMethodsSource.indexOf('async resolveUrnAsync');
  const searchOnline = resolveDownloadMethodsSource.slice(searchStart, urnStart);
  const resolveUrnAsync = extractMethod(resolveDownloadMethodsSource, 'resolveUrnAsync');
  const fetchUrnLocalMatches = extractMethod(searchPanelMethodsSource, 'fetchUrnLocalMatches');
  const refreshUrnLocalMatches = extractMethod(searchPanelMethodsSource, 'refreshUrnLocalMatches');
  const refreshLocalMatchesForMissing = extractMethod(
    resolveDownloadMethodsSource,
    'refreshLocalMatchesForMissing'
  );

  assert.match(searchOnline, /isCurrentSearchRun/);
  assert.match(searchOnline, /currentSearchRun/);
  assert.match(searchOnline, /if \(searchRunId && !isCurrentSearchRun\(\)\) return/);
  assert.match(searchOnline, /currentSearchRun && searchBtn\?\.isConnected !== false/);
  assert.match(resolveUrnAsync, /urnResolveUiTokens/);
  assert.match(resolveUrnAsync, /isCurrentUrnUi/);
  assert.match(resolveUrnAsync, /else if \(data\) \{\s*return;/);
  assert.match(fetchUrnLocalMatches, /getUrnResolveKey\(missing\).*filename/);
  assert.match(fetchUrnLocalMatches, /expected_filename !== filename/);
  assert.match(refreshUrnLocalMatches, /beginLocalMatchRefresh/);
  assert.match(refreshUrnLocalMatches, /container\?\.isConnected !== false/);
  assert.match(refreshUrnLocalMatches, /finishLocalMatchRefresh/);
  assert.match(refreshLocalMatchesForMissing, /beginLocalMatchRefresh/);
  assert.match(refreshLocalMatchesForMissing, /isCurrentLocalMatchRefresh/);
  assert.match(refreshLocalMatchesForMissing, /finishLocalMatchRefresh/);
});

test('local match status group warns when match folder is unsupported by node', () => {
  const renderLocalMatchStatus = eval(`(${extractMethod(searchPanelMethodsSource, 'renderLocalMatchStatus')})`);
  const getLocalMatchCategory = eval(`(${extractMethod(searchPanelMethodsSource, 'getLocalMatchCategory')})`);
  const getLocalMatchBadFolderWarning = eval(`(${extractMethod(searchPanelMethodsSource, 'getLocalMatchBadFolderWarning')})`);
  const renderLocalMatchBadFolderBadge = eval(`(${extractMethod(searchPanelMethodsSource, 'renderLocalMatchBadFolderBadge')})`);
  const renderLocalMatchStatusGroup = eval(`(${extractMethod(searchPanelMethodsSource, 'renderLocalMatchStatusGroup')})`);
  const dialog = {
    renderLocalMatchStatus,
    getLocalMatchCategory,
    getLocalMatchBadFolderWarning,
    renderLocalMatchBadFolderBadge,
    renderLocalMatchDownloadingBadge() {
      return '';
    },
    normalizeDownloadCategory(value = '') {
      return {
        checkpoint: 'checkpoints',
        checkpoints: 'checkpoints',
        diffusion_model: 'diffusion_models',
        diffusion_models: 'diffusion_models',
      }[String(value || '').trim()] || String(value || '').trim();
    },
    getMissingSupportedDownloadCategories() {
      return ['diffusion_models'];
    },
    getCategoryDisplayName(value) {
      return {
        checkpoints: 'Checkpoints',
        diffusion_models: 'Diffusion Models',
      }[value] || value;
    },
    escapeHtml(value) {
      return String(value).replace(/[&<>\"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));
    },
  };

  const html = renderLocalMatchStatusGroup.call(
    dialog,
    { category: 'diffusion_models' },
    {
      confidence: 100,
      match_type: 'hash',
      hash_match: true,
      model: { category: 'checkpoints' },
    }
  );

  assert.match(html, /mr-match-status-group/);
  assert.match(html, /mr-match-status-hash[^>]*>Hash</);
  assert.match(html, /mr-match-status-bad-folder[^>]*>Bad folder</);
  assert.match(html, /This local file is in Checkpoints/);
  assert.match(html, /this node likely accepts Diffusion Models/);
});

test('local match bad folder badge is omitted for supported folder', () => {
  const getLocalMatchCategory = eval(`(${extractMethod(searchPanelMethodsSource, 'getLocalMatchCategory')})`);
  const getLocalMatchBadFolderWarning = eval(`(${extractMethod(searchPanelMethodsSource, 'getLocalMatchBadFolderWarning')})`);
  const renderLocalMatchBadFolderBadge = eval(`(${extractMethod(searchPanelMethodsSource, 'renderLocalMatchBadFolderBadge')})`);
  const dialog = {
    getLocalMatchCategory,
    getLocalMatchBadFolderWarning,
    normalizeDownloadCategory(value = '') {
      return String(value || '').trim();
    },
    getMissingSupportedDownloadCategories() {
      return ['diffusion_models'];
    },
    escapeHtml(value) {
      return String(value);
    },
  };

  const html = renderLocalMatchBadFolderBadge.call(
    dialog,
    { category: 'diffusion_models' },
    { confidence: 100, model: { category: 'diffusion_models' } }
  );

  assert.equal(html, '');
});

test('local match bad folder badge treats gguf folder keys as diffusion models', () => {
  const getLocalMatchCategory = eval(`(${extractMethod(searchPanelMethodsSource, 'getLocalMatchCategory')})`);
  const getLocalMatchBadFolderWarning = eval(`(${extractMethod(searchPanelMethodsSource, 'getLocalMatchBadFolderWarning')})`);
  const renderLocalMatchBadFolderBadge = eval(`(${extractMethod(searchPanelMethodsSource, 'renderLocalMatchBadFolderBadge')})`);
  const dialog = {
    getLocalMatchCategory,
    getLocalMatchBadFolderWarning,
    normalizeDownloadCategory(value = '') {
      return {
        unet_gguf: 'diffusion_models',
        model_gguf: 'diffusion_models',
      }[String(value || '').trim()] || String(value || '').trim();
    },
    getMissingSupportedDownloadCategories() {
      return ['diffusion_models'];
    },
    escapeHtml(value) {
      return String(value);
    },
  };

  const html = renderLocalMatchBadFolderBadge.call(
    dialog,
    { category: 'diffusion_models' },
    { confidence: 100, model: { category: 'model_gguf' } }
  );

  assert.equal(html, '');
});

test('local match bad type badge warns when node catalog does not accept gguf', () => {
  const getModelFileTypeInfo = eval(`(${extractMethod(searchPanelMethodsSource, 'getModelFileTypeInfo')})`);
  const getMissingAcceptedModelFileTypes = eval(`(${extractMethod(searchPanelMethodsSource, 'getMissingAcceptedModelFileTypes')})`);
  const getLocalMatchBadTypeWarning = eval(`(${extractMethod(searchPanelMethodsSource, 'getLocalMatchBadTypeWarning')})`);
  const renderLocalMatchBadTypeBadge = eval(`(${extractMethod(searchPanelMethodsSource, 'renderLocalMatchBadTypeBadge')})`);
  const dialog = {
    getModelFileTypeInfo,
    getMissingAcceptedModelFileTypes,
    getLocalMatchBadTypeWarning,
    getCurrentComfyCatalogValues(nodeType, widgetName) {
      assert.equal(nodeType, 'CLIPLoader');
      assert.equal(widgetName, 'clip_name');
      return [
        'QWEN/qwen3vl_4b_fp8_scaled.safetensors',
        'FLUX/t5xxl_fp16.safetensors',
      ];
    },
    escapeHtml(value) {
      return String(value).replace(/"/g, '&quot;');
    },
  };

  const html = renderLocalMatchBadTypeBadge.call(
    dialog,
    {
      node_type: 'CLIPLoader',
      node_title: 'Load CLIP',
      widget_name: 'clip_name',
      widget_index: 0,
    },
    {
      confidence: 76.7,
      model: { relative_path: 'QWEN/Qwen3-4B-abliterated-iq4_nl.gguf' },
    }
  );

  assert.match(html, /mr-match-status-bad-type[^>]*>Bad type</);
  assert.match(html, /This file is GGUF \(.gguf\)/);
  assert.match(html, /Load CLIP only lists Safetensors \(.safetensors\) files/);
  assert.match(html, /use a loader made for GGUF models/);
});

test('local match bad type badge is omitted for a file type accepted by node catalog', () => {
  const getModelFileTypeInfo = eval(`(${extractMethod(searchPanelMethodsSource, 'getModelFileTypeInfo')})`);
  const getMissingAcceptedModelFileTypes = eval(`(${extractMethod(searchPanelMethodsSource, 'getMissingAcceptedModelFileTypes')})`);
  const getLocalMatchBadTypeWarning = eval(`(${extractMethod(searchPanelMethodsSource, 'getLocalMatchBadTypeWarning')})`);
  const renderLocalMatchBadTypeBadge = eval(`(${extractMethod(searchPanelMethodsSource, 'renderLocalMatchBadTypeBadge')})`);
  const dialog = {
    getModelFileTypeInfo,
    getMissingAcceptedModelFileTypes,
    getLocalMatchBadTypeWarning,
    getCurrentComfyCatalogValues() {
      return ['QWEN/qwen3vl_4b_fp8_scaled.safetensors'];
    },
    escapeHtml(value) {
      return String(value);
    },
  };

  const html = renderLocalMatchBadTypeBadge.call(
    dialog,
    { node_type: 'CLIPLoader', widget_name: 'clip_name', widget_index: 0 },
    { model: { relative_path: 'QWEN/another_text_encoder.safetensors' } }
  );

  assert.equal(html, '');
});

test('download category normalization maps gguf folder keys to diffusion models', () => {
  const normalizeDownloadCategory = eval(`(${extractMethod(downloadTargetMethodsSource, 'normalizeDownloadCategory')})`);

  assert.equal(normalizeDownloadCategory('unet_gguf'), 'diffusion_models');
  assert.equal(normalizeDownloadCategory('UNET GGUF'), 'diffusion_models');
  assert.equal(normalizeDownloadCategory('model_gguf'), 'diffusion_models');
});

test('download category normalization uses the generated backend alias fallback', () => {
  assert.equal(CATEGORY_ALIASES.control_net, 'controlnet');
  assert.equal(normalizeDownloadCategoryValue('control-net'), 'controlnet');
});

test('download category normalization follows the shared separator contract', () => {
  const expected = [
    ['  TEXTUAL\\INVERSION  ', 'embeddings'],
    ['unet / gguf', 'diffusion_models'],
    ['select---safetensors', 'diffusion_models'],
    ['clip__vision', 'clip_vision'],
  ];

  for (const [rawCategory, canonicalCategory] of expected) {
    assert.equal(normalizeCategoryToken(rawCategory), rawCategory
      .trim()
      .toLowerCase()
      .replace(/[/\\\s-]+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, ''));
    assert.equal(normalizeDownloadCategoryValue(rawCategory), canonicalCategory);
  }
});

test('missing model categories preserve node priority and fallback order', () => {
  const getMissingSupportedDownloadCategories = eval(
    `(${extractMethod(downloadTargetMethodsSource, 'getMissingSupportedDownloadCategories')})`
  );
  const dialog = {
    downloadDirectories: {
      checkpoints: [],
      loras: [],
      vae: [],
    },
    getDefaultDownloadCategoryKeys() {
      return [];
    },
    getKnownDownloadCategorySet() {
      return new Set(Object.keys(this.downloadDirectories));
    },
    normalizeDownloadCategory(value = '') {
      return String(value || '').trim().toLowerCase();
    },
    getMissingNodeTypeDownloadCategory(missing) {
      return missing.node_category || '';
    },
  };

  assert.deepEqual(
    getMissingSupportedDownloadCategories.call(dialog, {
      node_category: 'loras',
      category: 'checkpoints',
      directory: 'vae',
    }),
    ['loras']
  );
  assert.deepEqual(
    getMissingSupportedDownloadCategories.call(dialog, {
      category: 'checkpoints, checkpoints',
      directory: 'vae|loras',
    }),
    ['checkpoints', 'vae', 'loras']
  );
});

test('download category normalization maps select safetensors alias to diffusion models', () => {
  const normalizeDownloadCategory = eval(`(${extractMethod(downloadTargetMethodsSource, 'normalizeDownloadCategory')})`);

  assert.equal(normalizeDownloadCategory('select_safetensors'), 'diffusion_models');
  assert.equal(normalizeDownloadCategory('SELECT SAFETENSORS'), 'diffusion_models');
});

test('download category normalization prefers backend capabilities aliases', () => {
  const normalizeDownloadCategory = eval(`(${extractMethod(downloadTargetMethodsSource, 'normalizeDownloadCategory')})`);
  const dialog = {
    capabilities: {
      category_aliases: {
        textual_inversion: 'embeddings',
        custom_alias: 'checkpoints',
      },
    },
  };

  assert.equal(normalizeDownloadCategory.call(dialog, 'Textual Inversion'), 'embeddings');
  assert.equal(normalizeDownloadCategory.call(dialog, 'custom-alias'), 'checkpoints');
  assert.equal(normalizeDownloadCategory.call(dialog, 'unet_gguf'), 'unet_gguf');
});

test('category display names use exact ComfyUI folder keys', () => {
  const normalizeDownloadCategory = eval(`(${extractMethod(downloadTargetMethodsSource, 'normalizeDownloadCategory')})`);
  const getCategoryDisplayName = eval(`(${extractMethod(downloadTargetMethodsSource, 'getCategoryDisplayName')})`);
  const dialog = { normalizeDownloadCategory };

  assert.equal(getCategoryDisplayName.call(dialog, 'audio_encoders'), 'audio_encoders');
  assert.equal(getCategoryDisplayName.call(dialog, 'audio_encoder'), 'audio_encoders');
  assert.equal(getCategoryDisplayName.call(dialog, 'text_encoders'), 'text_encoders');
  assert.equal(getCategoryDisplayName.call(dialog, 'style_models'), 'style_models');
  assert.equal(getCategoryDisplayName.call(dialog, 'model_patches'), 'model_patches');
  assert.equal(getCategoryDisplayName.call(dialog, 'upscale_models'), 'upscale_models');
  assert.equal(getCategoryDisplayName.call(dialog, 'loras'), 'loras');
  assert.equal(getCategoryDisplayName.call(dialog, 'checkpoints'), 'checkpoints');
});

test('download path settings label categories with exact folder keys', () => {
  const getDefaultDownloadPathTemplates = eval(`(${extractMethod(downloadTargetMethodsSource, 'getDefaultDownloadPathTemplates')})`);
  const getDownloadPathTemplateCategoryDefinitions = eval(`(${extractMethod(downloadTargetMethodsSource, 'getDownloadPathTemplateCategoryDefinitions')})`);
  const getDefaultRootCategoryDefinitions = eval(`(${extractMethod(downloadTargetMethodsSource, 'getDefaultRootCategoryDefinitions')})`);
  const dialog = { getDefaultDownloadPathTemplates };

  const templateCategories = getDownloadPathTemplateCategoryDefinitions.call(dialog);
  const rootCategories = getDefaultRootCategoryDefinitions.call(dialog);

  assert.deepEqual(
    templateCategories.map(item => item.label),
    templateCategories.map(item => item.key)
  );
  assert.equal(
    rootCategories.find(item => item.key === 'text_encoders').label,
    'text_encoders'
  );
  assert.equal(
    rootCategories.find(item => item.key === 'upscale_models').label,
    'upscale_models'
  );
});

test('missing model preview shows accepted GGUF format next to its category', () => {
  const renderMissingModelFormatBadges = eval(`(${extractMethod(missingBrowserMethodsSource, 'renderMissingModelFormatBadges')})`);
  const dialog = {
    getMissingAcceptedModelFileTypes() {
      return [{ extension: 'gguf', label: 'GGUF', display: 'GGUF (.gguf)' }];
    },
    escapeHtml(value) {
      return String(value).replace(/[&<>\"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));
    },
  };

  const html = renderMissingModelFormatBadges.call(dialog, {
    category: 'diffusion_models',
    node_type: 'UnetLoaderGGUF',
  });

  assert.match(html, /mr-model-format-chip/);
  assert.match(html, />GGUF<\/span>/);
  assert.match(html, /Accepted file format for this node: GGUF \(\.gguf\)\./);
});

test('hash match label map numbers distinct matched hashes', () => {
  const {
    getLocalMatchHash,
    collectHashLabelMapHashes,
    getHashMatchLabelMap,
  } = searchHashMethods;
  const firstHash = 'a'.repeat(64);
  const secondHash = 'b'.repeat(64);
  const dialog = {
    getLocalMatchHash,
    collectHashLabelMapHashes,
  };

  const singleMap = getHashMatchLabelMap.call(dialog, {
    matches: [{ match_type: 'hash', hash_match: true, sha256: firstHash }],
  });
  assert.equal(singleMap.get(firstHash), 'Hash');

  const numberedMap = getHashMatchLabelMap.call(dialog, {
    matches: [
      { match_type: 'hash', hash_match: true, sha256: firstHash },
      { match_type: 'hash', hash_match: true, sha256: secondHash },
    ],
  });

  assert.equal(numberedMap.get(firstHash), 'Hash 1');
  assert.equal(numberedMap.get(secondHash), 'Hash 2');
});

test('search result hash labels use linked local hash identity', () => {
  const {
    getSearchResultSha256,
    getHashMatchLabelForSearchResult,
  } = searchHashMethods;
  const getSearchResultMatchDisplay = eval(`(${extractMethod(searchPanelMethodsSource, 'getSearchResultMatchDisplay')})`);
  const sha256 = 'd'.repeat(64);
  const hashLabelMap = new Map([[sha256, 'Hash 2']]);
  const dialog = {
    getSearchResultSha256,
  };
  const result = {
    match_type: 'exact',
    hashes: { SHA256: sha256 },
  };

  assert.equal(
    getHashMatchLabelForSearchResult.call(dialog, result, hashLabelMap, []),
    ''
  );
  assert.equal(
    getHashMatchLabelForSearchResult.call(dialog, result, hashLabelMap, ['local-match-id']),
    'Hash 2'
  );
  assert.deepEqual(
    getSearchResultMatchDisplay(result, 'Exact', 'strong', 'Hash 2'),
    { label: 'Hash 2', className: 'hash' }
  );
});

test('local hash identities link search results across sources by sha', () => {
  const {
    getLocalMatchHash,
    getSearchResultSha256,
    getLocalHashMatchIdentitiesForResult,
  } = searchHashMethods;
  const sha256 = 'e'.repeat(64);
  const dialog = {
    getLocalMatchHash,
    getSearchResultSha256,
    getLocalMatchIdentity() {
      return 'local-match-id';
    },
  };

  const identities = getLocalHashMatchIdentitiesForResult.call(dialog, [{
    hash_lookup_source: 'huggingface',
    match_type: 'hash',
    sha256,
  }], 'civitai', {
    match_type: 'exact',
    hashes: { SHA256: sha256 },
  });

  assert.deepEqual(identities, ['local-match-id']);
});

test('remote hash sync fetches local matches by selected result sha', async () => {
  const { getSearchResultSha256 } = searchHashMethods;
  const getExistingLocalHashMatchesForSha = eval(`(${extractMethod(resolveDownloadMethodsSource, 'getExistingLocalHashMatchesForSha')})`);
  const syncRemoteHashMatchesForResult = eval(`(${extractMethod(resolveDownloadMethodsSource, 'syncRemoteHashMatchesForResult')})`);
  const sha256 = 'f'.repeat(64);
  const calls = [];
  const applied = [{ sha256, hash_match: true }];
  const missing = {
    category: 'diffusion_models',
    original_path: 'model.safetensors',
    matches: [],
  };
  const state = { results: { local_hash_matches: [] } };
  const dialog = {
    getSearchResultSha256,
    getExistingLocalHashMatchesForSha,
    getWorkflowScopedQueueKey() {
      return 'workflow-key';
    },
    getSearchStateForWorkflow(workflowKey, value) {
      assert.equal(workflowKey, 'workflow-key');
      assert.equal(value, missing);
      return state;
    },
    getMissingSearchKey() {
      return 'missing-key';
    },
    async fetchJson(endpoint, options) {
      calls.push([endpoint, JSON.parse(options.body)]);
      return { local_hash_matches: applied };
    },
    applyLocalHashMatchesFromSearchResponse(value, data, options) {
      assert.equal(value, missing);
      assert.deepEqual(data.local_hash_matches, applied);
      assert.equal(options.workflowKey, 'workflow-key');
      return applied;
    },
  };

  const matches = await syncRemoteHashMatchesForResult.call(dialog, missing, {
    source: 'civitai',
    filename: 'model.safetensors',
    hashes: { SHA256: sha256 },
  });

  assert.equal(matches, applied);
  assert.deepEqual(calls, [[
    '/model_resolver/local-matches-by-hash',
    {
      sha256,
      category: 'diffusion_models',
      source: 'civitai',
      filename: 'model.safetensors',
      max_matches: 20,
    },
  ]]);
});

test('local hash badge hover highlights linked search result row', () => {
  const wireLocalHashMatchResultHighlights = eval(`(${extractMethod(searchPanelMethodsSource, 'wireLocalHashMatchResultHighlights')})`);
  const listeners = {};
  const badge = {
    dataset: {},
    addEventListener(eventName, callback) {
      listeners[eventName] = callback;
    },
    closest(selector) {
      return selector === '.mr-match-row'
        ? { dataset: { localMatchIdentity: 'match-id' } }
        : null;
    },
  };
  const container = {
    querySelectorAll(selector) {
      assert.equal(selector, '.mr-match-row[data-local-match-identity] .mr-match-status-hash');
      return [badge];
    },
  };
  const calls = [];
  const dialog = {
    setSearchHashResultHighlight(containerArg, identity, highlighted) {
      assert.equal(containerArg, container);
      calls.push([identity, highlighted]);
    },
  };

  wireLocalHashMatchResultHighlights.call(dialog, container);
  listeners.mouseenter();
  listeners.mouseleave();

  assert.deepEqual(calls, [
    ['match-id', true],
    ['match-id', false],
  ]);
});

test('search result highlight toggles linked hash result row and badge', () => {
  const decodeLocalMatchIdentityList = eval(`(${extractMethod(searchPanelMethodsSource, 'decodeLocalMatchIdentityList')})`);
  const setSearchHashResultHighlight = eval(`(${extractMethod(searchPanelMethodsSource, 'setSearchHashResultHighlight')})`);
  const rowToggles = [];
  const badgeToggles = [];
  const row = {
    classList: {
      toggle(className, enabled) {
        rowToggles.push([className, enabled]);
      },
    },
  };
  const badge = {
    dataset: {
      localMatchIdentities: encodeURIComponent(JSON.stringify(['match-id'])),
    },
    classList: {
      toggle(className, enabled) {
        badgeToggles.push([className, enabled]);
      },
    },
    closest(selector) {
      return selector === 'tr' ? row : null;
    },
  };
  const scope = {
    querySelectorAll(selector) {
      assert.equal(selector, '.mr-search-match[data-local-match-identities]');
      return [badge];
    },
  };
  const container = {
    closest(selector) {
      return selector === '.mr-columns' ? scope : null;
    },
  };
  const dialog = { decodeLocalMatchIdentityList };

  setSearchHashResultHighlight.call(dialog, container, 'match-id', true);

  assert.deepEqual(badgeToggles, [['mr-search-match-linked-highlight', true]]);
  assert.deepEqual(rowToggles, [['mr-search-result-hash-highlight', true]]);
});

test('search result table exposes linked local hash targets for exact matches', () => {
  const renderSearchResultsTable = eval(`(${extractMethod(searchPanelMethodsSource, 'renderSearchResultsTable')})`);
  const dialog = {
    getSearchResultsTableLayout() {
      return {
        sourcePx: 100,
        matchPx: 64,
        sizePx: 64,
        actionsPx: 72,
        tableMinPx: 360,
      };
    },
    renderSearchSourcePill() {
      return '<span>Source</span>';
    },
    escapeHtml(value) {
      return String(value).replace(/[&<>"']/g, char => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      }[char]));
    },
    getVersionedModelName(name, version) {
      return version ? `${name} ${version}` : name;
    },
    renderVersionedModelNameHtml(name) {
      return this.escapeHtml(name);
    },
    getContextMenuAttrs() {
      return '';
    },
  };

  const html = renderSearchResultsTable.call(dialog, [{
    sourceKey: 'civitai',
    sourceLabel: 'CivitAI',
    model: 'Sick Ollie',
    match: { label: 'Exact', className: 'strong' },
    size: '5.7 GB',
    localHashMatchIdentities: ['match-id'],
  }]);

  assert.match(html, /class="mr-search-match mr-search-match-strong mr-search-match-has-local-target"/);
  assert.match(html, /data-local-match-identities="%5B%22match-id%22%5D"/);
  assert.match(html, />Exact<\/span>/);
});

test('CivitAI hash search renders sizeKB when byte size is unavailable', () => {
  const formatSearchResultSize = eval(`(${extractMethod(searchPanelMethodsSource, 'formatSearchResultSize')})`);
  const dialog = {
    formatBytes(value) {
      const units = ['B', 'KB', 'MB', 'GB'];
      let index = 0;
      let number = Number(value);
      while (number >= 1024 && index < units.length - 1) {
        number /= 1024;
        index += 1;
      }
      return `${Number(number.toFixed(1))} ${units[index]}`;
    },
  };

  assert.equal(
    formatSearchResultSize.call(dialog, {
      source: 'civitai',
      match_type: 'hash',
      size: null,
      sizeKB: 12021353.90625,
    }),
    '11.5 GB'
  );
  assert.equal(
    formatSearchResultSize.call(dialog, {
      source: 'civitai',
      size: null,
      files: [{ name: 'zImageTurbo_turbo.safetensors', sizeKB: 12021353.90625 }],
    }),
    '11.5 GB'
  );
});

test('link/name controls place the add or search action before the input switch', () => {
  const renderSearchControls = eval(`(${extractMethod(searchPanelMethodsSource, 'renderSearchControls')})`);
  const dialog = {
    getSearchState() {
      return {
        selectedSource: 'all',
        selectedBaseModel: 'auto',
        inputMode: 'link',
        manualSearchQuery: '',
      };
    },
    getDefaultSearchBaseModel() {
      return 'auto';
    },
    getSearchBaseModelTooltip() {
      return '';
    },
    hasRenderableSearchState() {
      return false;
    },
    getLinkNameInputMode(state) {
      return state.inputMode;
    },
    getSearchSourceLabel() {
      return 'All';
    },
    getSearchBaseModelLabel() {
      return 'Any model';
    },
    getMissingSearchKey() {
      return 'missing-key';
    },
    escapeHtml(value) {
      return String(value);
    },
    renderSearchButtonContent() {
      return 'search';
    },
    renderLinkNameActionContent() {
      return 'action';
    },
    renderLinkNameSwitchIcon() {
      return 'switch';
    },
  };

  const html = renderSearchControls.call(dialog, { node_id: 1, widget_index: 2 });
  const actionIndex = html.indexOf('mr-link-name-action-picker');
  const inputIndex = html.indexOf('mr-link-name-input-picker');
  const modeIndex = html.indexOf('mr-link-name-mode');

  assert.ok(actionIndex >= 0);
  assert.ok(inputIndex > actionIndex);
  assert.ok(modeIndex > inputIndex);
});

test('search result refreshes preserve keyed progress and result DOM', () => {
  const displaySearchResults = extractMethod(resolveDownloadMethodsSource, 'displaySearchResults');
  const patchSearchResultsContainer = extractMethod(
    resolveDownloadMethodsSource,
    'patchSearchResultsContainer'
  );
  const patchSearchProgressElement = extractMethod(
    resolveDownloadMethodsSource,
    'patchSearchProgressElement'
  );
  const patchSearchResultsTable = extractMethod(
    resolveDownloadMethodsSource,
    'patchSearchResultsTable'
  );
  const wireSearchDownloadButtons = extractMethod(
    resolveDownloadMethodsSource,
    'wireSearchDownloadButtons'
  );

  assert.match(displaySearchResults, /patchSearchResultsContainer\(/);
  assert.doesNotMatch(displaySearchResults, /container\.innerHTML\s*=/);
  assert.match(patchSearchProgressElement, /data-search-progress-source|searchProgressSource/);
  assert.match(patchSearchResultsTable, /data-search-result-key|searchResultKey/);
  assert.match(wireSearchDownloadButtons, /bindEventOnce/);
  assert.match(wireSearchDownloadButtons, /search-result-actions/);
  assert.doesNotMatch(wireSearchDownloadButtons, /mlSearchDownloadBound/);
  assert.doesNotMatch(wireSearchDownloadButtons, /mlSearchOpenPageBound/);
  assert.doesNotMatch(wireSearchDownloadButtons, /mlSearchDetailsBound/);
  assert.match(resolveDownloadMethodsSource, /rows\.push\(\{ \.\.\.row, __searchResultKey: rowKey \}\)/);
  assert.match(searchPanelMethodsSource, /data-search-progress-source=/);
  assert.match(searchPanelMethodsSource, /data-search-result-key=/);
});

test('source model details file selection includes selected file hash metadata', () => {
  const renderSourceModelDetailsFiles = eval(`(${extractMethod(modelInfoMethodsSource, 'renderSourceModelDetailsFiles')})`);
  const sha256 = 'a'.repeat(64);
  const dialog = {
    isSourceModelDetailsTargetFile() {
      return false;
    },
    getSourceModelFileMeta() {
      return { summary: `SHA256 ${sha256}`, badges: [] };
    },
    getSourceModelMirrors() {
      return [];
    },
    getSourceModelPreferredMirror() {
      return null;
    },
    getSourceModelFileHash(file = {}) {
      const hashes = file.hashes && typeof file.hashes === 'object' ? file.hashes : {};
      return String(file.sha256 || file.hash || hashes.SHA256 || hashes.sha256 || '').trim().toLowerCase();
    },
    renderSourceModelMirrors() {
      return '';
    },
    escapeHtml(value) {
      return String(value).replace(/[&<>"']/g, char => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      }[char]));
    },
  };

  const html = renderSourceModelDetailsFiles.call(dialog, {
    id: 22,
    name: 'fp8',
    base_model: 'Z-Image',
    files: [{
      name: 'sickOllie_v1_fp8.safetensors',
      download_url: 'https://example.test/model.safetensors',
      size: 5700000000,
      hashes: { SHA256: sha256 },
    }],
  }, {
    source: 'civitai',
    model_id: 11,
    name: 'Sick Ollie',
  }, {});

  const selectionMatch = html.match(/data-selection="([^"]+)"/);
  assert.ok(selectionMatch, 'selection payload missing');
  const payload = JSON.parse(decodeURIComponent(selectionMatch[1]));

  assert.equal(payload.sha256, sha256);
  assert.equal(payload.hashes.SHA256, sha256);
  assert.equal(payload.file_info.hashes.SHA256, sha256);
  assert.equal(payload.selected_file.hashes.SHA256, sha256);
  assert.equal(payload.selected_version.files[0].hashes.SHA256, sha256);
});

test('applying source model details selection updates current download source hashes', () => {
  const applySourceModelDetailsSelection = eval(`(${extractMethod(modelInfoMethodsSource, 'applySourceModelDetailsSelection')})`);
  const sha256 = 'b'.repeat(64);
  const missing = {
    original_path: 'sickOllie_v1.safetensors',
    category: 'diffusion_models',
    civitai_info: {},
  };
  const state = { results: {} };
  const refreshCalls = [];
  const dialog = {
    getMissingByKey(key) {
      return key === 'missing-key' ? missing : null;
    },
    getSearchState(value) {
      assert.equal(value, missing);
      return state;
    },
    getSourceModelFileHash(value = {}) {
      const hashes = value.hashes && typeof value.hashes === 'object' ? value.hashes : {};
      return String(value.sha256 || value.hash || hashes.SHA256 || hashes.sha256 || '').trim().toLowerCase();
    },
    resolveBaseModelAlias(value) {
      return value;
    },
    refreshSearchUiForMissing(value, nextState) {
      refreshCalls.push([value, nextState]);
    },
    refreshSearchBaseModelLabels() {},
    updateBatchFooterButtons() {},
    persistSearchStateForActiveWorkflow() {},
    showNotification() {},
  };
  const selectedFile = {
    name: 'sickOllie_v1_fp8.safetensors',
    download_url: 'https://example.test/model.safetensors',
    hashes: { SHA256: sha256 },
  };

  applySourceModelDetailsSelection.call(dialog, {
    source: 'civitai',
    model_id: 11,
    version_id: 22,
    name: 'Sick Ollie',
    version_name: 'fp8',
    filename: selectedFile.name,
    download_url: selectedFile.download_url,
    url: 'https://civitai.com/models/11?modelVersionId=22',
    size: 5700000000,
    base_model: 'Z-Image',
    hashes: { SHA256: sha256 },
    file_info: selectedFile,
    selected_file: selectedFile,
    selected_version: { id: 22, name: 'fp8', files: [selectedFile] },
  }, {
    missing_key: 'missing-key',
    details_source: 'civitai',
  });

  assert.equal(missing.download_source.sha256, sha256);
  assert.equal(missing.download_source.hashes.SHA256, sha256);
  assert.equal(missing.download_source.file_info.hashes.SHA256, sha256);
  assert.equal(missing.download_source.selected_file.hashes.SHA256, sha256);
  assert.equal(missing.download_source.selected_version.files[0].hashes.SHA256, sha256);
  assert.equal(state.results.civitai.sha256, sha256);
  assert.equal(state.results.civitai.file_info.hashes.SHA256, sha256);
  assert.equal(refreshCalls.length, 1);
});
