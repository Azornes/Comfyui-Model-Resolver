import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tabsLoadedMethods } from '../web/resolver/views/tabs_loaded_methods.js';
import { safeStorage } from '../web/resolver/utils/html_utils.js';

globalThis.safeStorage = safeStorage;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const lifecycleGraphMethodsSource = fs.readFileSync(
    path.join(repoRoot, 'web/resolver/shell/lifecycle_graph_methods.js'),
    'utf8'
);
const queueMethodsSource = fs.readFileSync(
    path.join(repoRoot, 'web/resolver/actions/queue_methods.js'),
    'utf8'
);

function extractMethod(source, methodName, paramsPattern = '[^)]*') {
    const signatureRegex = new RegExp(`\\n\\s+(?:async\\s+)?${methodName}\\s*\\(${paramsPattern}\\)\\s*\\{`);
    const match = signatureRegex.exec(source);
    assert.ok(match, `Could not find ${methodName}`);
    const parenStart = source.indexOf('(', match.index);
    const parenEnd = source.indexOf(')', parenStart);
    const braceStart = source.indexOf('{', parenEnd);
    let depth = 0;
    for (let index = braceStart; index < source.length; index += 1) {
        const char = source[index];
        if (char === '{') depth += 1;
        if (char === '}') depth -= 1;
        if (depth === 0) {
            const params = source.slice(parenStart + 1, parenEnd);
            const isAsync = match[0].includes('async');
            return `${isAsync ? 'async ' : ''}function ${methodName}(${params}) ${source.slice(braceStart, index + 1)}`;
        }
    }
    throw new Error(`Could not parse ${methodName}`);
}

const animateTabContentTransition = eval(`(${extractMethod(queueMethodsSource, 'animateTabContentTransition')})`);
const closeDialog = eval(`(${extractMethod(lifecycleGraphMethodsSource, 'close')})`);
const showContent = eval(`(${extractMethod(lifecycleGraphMethodsSource, 'showContent')})`);

test('switchTab calls animateTabContentTransition by default', () => {
    let animationCalled = 0;
    const ctx = {
        ...tabsLoadedMethods,
        activeTab: 'missing',
        getValidTab: (t) => t,
        getTabButton: () => null,
        persistActiveTab: () => {},
        hideTooltip: () => {},
        animateTabContentTransition: () => { animationCalled++; },
        updateTabButtonStates: () => {},
        updateQueueVisibility: () => {},
        setMissingFooterControlsVisible: () => {},
        loadLoadedModels: () => 'loaded-loaded',
        contentElement: { style: {} },
    };

    const res = ctx.switchTab('loaded');
    assert.equal(animationCalled, 1);
    assert.equal(res, 'loaded-loaded');
    assert.equal(ctx.activeTab, 'loaded');
});

test('switchTab skips animateTabContentTransition when animate is false', () => {
    let animationCalled = 0;
    const ctx = {
        ...tabsLoadedMethods,
        activeTab: 'missing',
        getValidTab: (t) => t,
        getTabButton: () => null,
        persistActiveTab: () => {},
        hideTooltip: () => {},
        animateTabContentTransition: () => { animationCalled++; },
        updateTabButtonStates: () => {},
        updateQueueVisibility: () => {},
        setMissingFooterControlsVisible: () => {},
        loadLoadedModels: () => 'loaded-loaded',
        contentElement: { style: {} },
    };

    const res = ctx.switchTab('loaded', { force: true, animate: false });
    assert.equal(animationCalled, 0);
    assert.equal(res, 'loaded-loaded');
    assert.equal(ctx.activeTab, 'loaded');
});

test('switchTab forwards workflow argument to loadWorkflowData and loadLoadedModels', () => {
    let passedMissingWorkflow = null;
    let passedLoadedWorkflow = null;
    const customWorkflow = { nodes: [{ id: 42 }] };

    const ctx = {
        ...tabsLoadedMethods,
        activeTab: 'loaded',
        getValidTab: (t) => t,
        getTabButton: () => null,
        persistActiveTab: () => {},
        hideTooltip: () => {},
        animateTabContentTransition: () => {},
        updateTabButtonStates: () => {},
        updateQueueVisibility: () => {},
        setMissingFooterControlsVisible: () => {},
        loadWorkflowData: (wf) => { passedMissingWorkflow = wf; },
        loadLoadedModels: (wf) => { passedLoadedWorkflow = wf; },
        contentElement: { style: {} },
    };

    ctx.switchTab('missing', { force: true, animate: false, workflow: customWorkflow });
    assert.equal(passedMissingWorkflow, customWorkflow);

    ctx.switchTab('loaded', { force: true, animate: false, workflow: customWorkflow });
    assert.equal(passedLoadedWorkflow, customWorkflow);
});

test('animateTabContentTransition cancels any running animations on contentElement', () => {
    let cancelCount = 0;
    let animatedKeyframes = null;
    let animatedOptions = null;
    const dummyAnim = { cancel: () => { cancelCount++; } };

    const ctx = {
        contentElement: {
            getAnimations: () => [dummyAnim, dummyAnim],
            animate: (keyframes, opts) => {
                animatedKeyframes = keyframes;
                animatedOptions = opts;
            },
        },
    };

    animateTabContentTransition.call(ctx);
    assert.equal(cancelCount, 2);
    assert.deepEqual(animatedKeyframes, [
        { opacity: 0.72, transform: 'translateY(7px)' },
        { opacity: 1, transform: 'translateY(0)' }
    ]);
    assert.equal(animatedOptions.duration, 180);
});

test('close cancels running animations on contentElement', () => {
    let cancelCount = 0;
    const dummyAnim = { cancel: () => { cancelCount++; } };

    const ctx = {
        docked: false,
        dockContainer: null,
        rememberSidebarOpenMode: () => {},
        setDockDropPreviewActive: () => {},
        setUndockDropPreviewActive: () => {},
        hideTooltip: () => {},
        backdrop: { style: {} },
        element: { style: {} },
        contentElement: {
            getAnimations: () => [dummyAnim],
        },
    };

    closeDialog.call(ctx);
    assert.equal(cancelCount, 1);
    assert.equal(ctx.element.style.display, 'none');
    assert.equal(ctx.backdrop.style.display, 'none');
});

test('showContent restores loaded/metadata/options tabs without animation', async () => {
    for (const targetTab of ['loaded', 'metadata', 'options']) {
        const switchCalls = [];
        const ctx = {
            backdrop: { style: {} },
            element: { style: {} },
            scheduleModalViewportClamp: () => {},
            loadFooterVersion: async () => {},
            updateDownloadAllButtonState: () => {},
            _serverSettingsLoaded: true,
            ensureCapabilitiesLoaded: async () => {},
            ensureBaseModelsLoaded: async () => {},
            ensureAllModelsLoaded: async () => {},
            ensureDownloadDirectoriesLoaded: async () => {},
            attachDragHandleIfNeeded: () => {},
            restoreActiveTab: () => targetTab,
            updateTabButtonStates: () => {},
            updateQueueVisibility: () => {},
            syncWorkflowScopedQueue: () => {},
            getCurrentWorkflow: () => ({ id: 'wf' }),
            restoreActiveDownloadsFromBackend: async () => {},
            switchTab: async (tab, opts) => {
                switchCalls.push({ tab, opts });
            },
        };

        await showContent.call(ctx);
        assert.equal(switchCalls.length, 1);
        assert.equal(switchCalls[0].tab, targetTab);
        assert.equal(switchCalls[0].opts.animate, false);
        assert.equal(switchCalls[0].opts.force, true);
    }
});
