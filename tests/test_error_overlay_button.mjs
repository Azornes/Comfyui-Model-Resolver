import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { Window } from 'happy-dom';

const modelResolverSource = await readFile(
  new URL('../web/resolver/model_resolver.js', import.meta.url),
  'utf8'
);

function extractMethod(source, methodName) {
  const signature = `    ${methodName}(`;
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `Could not find ${methodName}`);

  const bodyStart = source.indexOf('{', start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] !== '}') continue;
    depth -= 1;
    if (depth === 0) return source.slice(bodyStart + 1, index);
  }

  throw new Error(`Could not parse ${methodName}`);
}

const hasNativeMissingModelEvidence = new Function(
  'overlay',
  'detailsButton',
  'ERROR_OVERLAY_MESSAGES_SELECTOR',
  'NATIVE_MISSING_MODEL_GROUP_SELECTOR',
  'NATIVE_MISSING_MODEL_ITEM_SELECTOR',
  'NATIVE_MISSING_MODEL_TEXT_PATTERN',
  extractMethod(modelResolverSource, 'hasNativeMissingModelEvidence')
);

const checkAndInjectErrorOverlayButton = new Function(
  'node',
  'ERROR_OVERLAY_SELECTOR',
  'ERROR_OVERLAY_DETAILS_BUTTON_SELECTOR',
  'ERROR_OVERLAY_RESOLVER_BUTTON_SELECTOR',
  extractMethod(modelResolverSource, 'checkAndInjectErrorOverlayButton')
);

const handleNativeMissingModelStoreChange = new Function(
  'store',
  extractMethod(modelResolverSource, 'handleNativeMissingModelStoreChange')
);

const findNativeErrorChunkUrls = new Function(
  'NATIVE_ERROR_CHUNK_PATTERN',
  extractMethod(modelResolverSource, 'findNativeErrorChunkUrls')
);

function createOverlay(window, detailsLabel) {
  const overlay = window.document.createElement('div');
  overlay.setAttribute('data-testid', 'error-overlay');

  const messages = window.document.createElement('div');
  messages.setAttribute('data-testid', 'error-overlay-messages');
  overlay.append(messages);

  const actions = window.document.createElement('div');
  const detailsButton = window.document.createElement('button');
  detailsButton.setAttribute('data-testid', 'error-overlay-see-errors');
  detailsButton.className = 'official-button';
  detailsButton.textContent = detailsLabel;
  actions.append(detailsButton);
  overlay.append(actions);
  window.document.body.append(overlay);

  return { overlay, actions, detailsButton };
}

function createResolver({ nativeMissingModelsPending = false } = {}) {
  const resolver = {
    nativeMissingModelsPending,
    nativeMissingModelsAutoOpened: false,
    autoOpenCount: 0,
    activationCount: 0,
    getNativeMissingModelCandidates(store) {
      const candidates = store?.missingModelCandidates?.value
        ?? store?.missingModelCandidates;
      return Array.isArray(candidates) ? candidates : [];
    },
    hasNativeMissingModelEvidence(overlay, detailsButton) {
      return hasNativeMissingModelEvidence.call(
        this,
        overlay,
        detailsButton,
        '[data-testid="error-overlay-messages"]',
        '[data-testid="error-group-missing-model"]',
        '[data-testid^="missing-model-"]',
        /\bmissing\s+models?\b/i
      );
    },
    maybeAutoOpenForNativeMissingModels() {
      this.autoOpenCount += 1;
    },
    checkNativeStoreForMissingModels() {},
    checkAndInjectErrorOverlayButton(node) {
      injectFor(this, node);
    },
    activateResolverButton() {
      this.activationCount += 1;
    },
  };
  return resolver;
}

function injectFor(resolver, node) {
  checkAndInjectErrorOverlayButton.call(
    resolver,
    node,
    '[data-testid="error-overlay"]',
    '[data-testid="error-overlay-see-errors"]',
    '[data-model-resolver-error-action="open"]'
  );
}

test('native error chunk lookup includes both ComfyUI frontend layouts', () => {
  const previousDocument = globalThis.document;
  const previousPerformanceDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    'performance'
  );
  const mainChunk = 'http://localhost:8188/assets/dialogService-main.js';
  const loaderChunk = 'http://localhost:8188/assets/dialogService-loader.js';
  const settingChunk = 'http://localhost:8188/assets/settingStore-main.js';

  globalThis.document = { querySelectorAll: () => [] };
  Object.defineProperty(globalThis, 'performance', {
    configurable: true,
    value: {
      getEntriesByType: () => [
        { name: loaderChunk, decodedBodySize: 1179 },
        { name: mainChunk, decodedBodySize: 1118077 },
        { name: settingChunk, decodedBodySize: 1600000 },
      ],
    },
  });

  try {
    assert.deepEqual(
      findNativeErrorChunkUrls.call({}, /(?:^|\/)\b(?:dialogService|settingStore)-[^/]+\.js(?:[?#]|$)/),
      [settingChunk, mainChunk, loaderChunk]
    );
  } finally {
    globalThis.document = previousDocument;
    if (previousPerformanceDescriptor) {
      Object.defineProperty(globalThis, 'performance', previousPerformanceDescriptor);
    } else {
      delete globalThis.performance;
    }
  }
});

test('error overlay gets one Model Resolver button for native missing-model state', () => {
  const window = new Window();
  const previousDocument = globalThis.document;
  globalThis.document = window.document;

  try {
    const { overlay, actions, detailsButton } = createOverlay(window, 'View details');
    const resolver = createResolver({ nativeMissingModelsPending: true });

    injectFor(resolver, overlay);
    injectFor(resolver, detailsButton);

    const resolverButton = actions.querySelector(
      '[data-model-resolver-error-action="open"]'
    );
    assert.ok(resolverButton);
    assert.equal(resolverButton.textContent, 'Open Model Resolver');
    assert.equal(resolverButton.className, detailsButton.className);
    assert.equal(resolverButton.style.marginLeft, '0.5rem');
    assert.deepEqual(
      Array.from(actions.children),
      [detailsButton, resolverButton]
    );
    assert.equal(resolver.nativeMissingModelsPending, true);
    assert.equal(resolver.autoOpenCount, 1);

    resolverButton.click();
    assert.equal(resolver.activationCount, 1);
    assert.equal(
      actions.querySelectorAll('[data-model-resolver-error-action="open"]').length,
      1
    );
  } finally {
    globalThis.document = previousDocument;
  }
});

test('error overlay is updated when native missing-model state arrives asynchronously', () => {
  const window = new Window();
  const previousDocument = globalThis.document;
  globalThis.document = window.document;

  try {
    const { overlay, actions } = createOverlay(window, 'View details');
    const resolver = createResolver();

    injectFor(resolver, overlay);
    assert.equal(
      actions.querySelector('[data-model-resolver-error-action="open"]'),
      null
    );

    handleNativeMissingModelStoreChange.call(resolver, {
      missingModelCandidates: [{ name: 'RealESRGAN_x2.pth' }],
    });

    assert.ok(actions.querySelector('[data-model-resolver-error-action="open"]'));
    assert.equal(resolver.nativeMissingModelsPending, true);
  } finally {
    globalThis.document = previousDocument;
  }
});

test('error overlay gets the button when ComfyUI labels the error as missing models', () => {
  const window = new Window();
  const previousDocument = globalThis.document;
  globalThis.document = window.document;

  try {
    const { overlay, actions } = createOverlay(window, 'Show missing models');
    const resolver = createResolver();

    injectFor(resolver, overlay);

    assert.ok(actions.querySelector('[data-model-resolver-error-action="open"]'));
  } finally {
    globalThis.document = previousDocument;
  }
});

test('error overlay does not get the button for custom-node-only errors', () => {
  const window = new Window();
  const previousDocument = globalThis.document;
  globalThis.document = window.document;

  try {
    const { overlay } = createOverlay(window, 'Show missing nodes');
    const resolver = createResolver();

    injectFor(resolver, overlay);

    assert.equal(
      overlay.querySelector('[data-model-resolver-error-action="open"]'),
      null
    );
    assert.equal(resolver.autoOpenCount, 0);
  } finally {
    globalThis.document = previousDocument;
  }
});

test('generic native errors do not get the button without model evidence', () => {
  const window = new Window();
  const previousDocument = globalThis.document;
  globalThis.document = window.document;

  try {
    const { overlay } = createOverlay(window, 'View details');
    const resolver = createResolver();

    injectFor(resolver, overlay);

    assert.equal(
      overlay.querySelector('[data-model-resolver-error-action="open"]'),
      null
    );
  } finally {
    globalThis.document = previousDocument;
  }
});
