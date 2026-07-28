import { app } from "../../../../../scripts/app.js";
import { api } from "../../../../../scripts/api.js";
import { $el } from "../../../../../scripts/ui.js";
import { getSvgIcon } from "../../utils/icon_utils.js";
import { safeStorage } from "../utils/html_utils.js";
export const dialogShellMethods = {
    createHeader() {
        // Create tabs
        this.missingTab = $el("button.mr-tab.mr-tab-active", {
            onclick: () => this.switchTab('missing')
        }, [$el("span.mr-tab-label", { textContent: "Missing Models" })]);

        this.loadedTab = $el("button.mr-tab", {
            onclick: () => this.switchTab('loaded')
        }, [$el("span.mr-tab-label", { textContent: "Loaded Models" })]);

        this.optionsTab = $el("button.mr-tab", {
            onclick: () => this.switchTab('options')
        }, [$el("span.mr-tab-label", { textContent: "Options" })]);
        if (this.activeTab === 'missing') {
            this.updateTabButtonStates();
        }

        const dragHandle = $el("div", {
            id: "model-resolver-drag-handle",
            ondragstart: (e) => e.preventDefault()
        }, [
            $el("span", { textContent: "⠿" })
        ]);
        this.setTooltip(dragHandle, "Drag window");

        const fullscreenButton = $el("button", {
            id: "model-resolver-fullscreen-toggle",
            className: "mr-window-btn mr-window-btn--fullscreen",
            innerHTML: getSvgIcon('windowMaximize', 'currentColor', 'mr-window-btn-icon'),
            ariaLabel: "Toggle full screen",
            onclick: () => this.toggleFullScreen()
        });
        this.setTooltip(fullscreenButton, "Toggle full screen");

        this.dockButton = $el("button", {
            id: "model-resolver-dock-toggle",
            className: "mr-window-btn mr-window-btn--dock",
            innerHTML: getSvgIcon('internalLink', 'currentColor', 'mr-window-btn-icon'),
            ariaLabel: "Dock Model Resolver to sidebar",
            onclick: () => this.dockToSidebar()
        });
        this.setTooltip(this.dockButton, "Dock to sidebar");

        this.undockButton = $el("button", {
            id: "model-resolver-undock-toggle",
            className: "mr-window-btn mr-window-btn--undock",
            innerHTML: getSvgIcon('externalLink', 'currentColor', 'mr-window-btn-icon'),
            ariaLabel: "Undock Model Resolver",
            onclick: () => this.undockToFloating()
        });
        this.setTooltip(this.undockButton, "Undock to floating window");

        return $el("div.mr-dialog-shell", {}, [
            $el("div.mr-dialog-topbar", {}, [
                $el("div.mr-dialog-brand", {}, [
                    dragHandle,
                    $el("div.mr-tabs", {}, [
                        this.missingTab,
                        this.loadedTab,
                        this.optionsTab
                    ])
                ]),
                $el("div.mr-dialog-controls", {}, [
                    this.dockButton,
                    this.undockButton,
                    fullscreenButton,
                    $el("button", {
                        className: "mr-window-btn mr-window-btn--close",
                        innerHTML: getSvgIcon('x', 'currentColor', 'mr-window-btn-icon'),
                        ariaLabel: "Close Model Resolver",
                        onclick: () => this.close()
                    })
                ])
            ])
        ]);
    },

    captureFloatingRect() {
        if (!this.element || this.docked || getComputedStyle(this.element).display === 'none') return;

        const rect = this.element.getBoundingClientRect();
        if (!rect.width || !rect.height) return;

        this._floatingRectBeforeDock = {
            top: Math.round(rect.top),
            left: Math.round(rect.left),
            width: Math.round(rect.width),
            height: Math.round(rect.height)
        };
    },

    clearModalPlacementStyles() {
        if (!this.element) return;

        [
            'position',
            'top',
            'left',
            'right',
            'bottom',
            'inset',
            'transform',
            'width',
            'height',
            'maxWidth',
            'maxHeight',
            'minWidth',
            'minHeight',
            'borderRadius',
            'resize'
        ].forEach((property) => {
            this.element.style[property] = '';
        });
    },

    restoreFloatingGeometry() {
        const el = this.element;
        if (!el) return;

        el.style.width = '1100px';
        el.style.height = '700px';
        el.style.maxWidth = '100vw';
        el.style.maxHeight = '100vh';
        el.style.minWidth = '640px';
        el.style.minHeight = '420px';
        el.style.resize = 'both';
        el.style.borderRadius = '7px';

        const rect = this._floatingRectBeforeDock;
        if (rect?.width && rect?.height) {
            el.style.width = `${rect.width}px`;
            el.style.height = `${rect.height}px`;
            el.style.top = `${rect.top}px`;
            el.style.left = `${rect.left}px`;
            el.style.transform = 'none';
            return;
        }

        const wh = JSON.parse(safeStorage.getItem('model_resolver_modal_size_before_fs') || 'null');
        if (wh?.w && wh?.h) {
            el.style.width = `${wh.w}px`;
            el.style.height = `${wh.h}px`;
        }

        const pos = JSON.parse(safeStorage.getItem('model_resolver_modal_pos') || 'null');
        if (pos && Number.isFinite(pos.top) && Number.isFinite(pos.left)) {
            el.style.top = `${pos.top}px`;
            el.style.left = `${pos.left}px`;
            el.style.transform = 'none';
            return;
        }

        el.style.top = '50%';
        el.style.left = '50%';
        el.style.transform = 'translate(-50%, -50%)';
    },

    rememberSidebarOpenMode(mode) {
        safeStorage.setItem(this.sidebarOpenModeStorageKey, mode === 'floating' ? 'floating' : 'docked');
    },

    shouldOpenFromSidebarFloating() {
        return safeStorage.getItem(this.sidebarOpenModeStorageKey) === 'floating';
    },

    isVisible() {
        if (!this.element?.isConnected) return false;
        return this.element.style.display === 'flex';
    },

    dockTo(container) {
        if (!container || !this.element) return;

        this.rememberDockDropPreviewWidth(container);
        if (!this.docked) {
            if (this._pendingDragDockRect) {
                this._floatingRectBeforeDock = this._pendingDragDockRect;
                this._pendingDragDockRect = null;
            } else {
                this.captureFloatingRect();
            }
        }

        this.setDockDropPreviewActive(false);
        this.setUndockDropPreviewActive(false);
        if (this.fullscreen) {
            this.setFullScreen(false);
        }

        this.docked = true;
        this.dockContainer = container;
        this.lastDockContainer = container;
        this.pendingDockToSidebar = false;
        this.rememberSidebarOpenMode('docked');
        this.backdrop.style.display = 'none';
        container.classList.add('mr-sidebar-dock-panel');
        this.element.classList.add('mr-is-docked');
        this.clearModalPlacementStyles();
        this.element.style.display = 'flex';

        if (this.element.parentNode !== container) {
            container.appendChild(this.element);
        }
        this.installSidebarSplitterOptimization();
    },

    installSidebarSplitterOptimization() {
        if (this._sidebarSplitterPointerDownHandler || this._sidebarSplitterMouseDownHandler) return;

        this._sidebarSplitterPointerDownHandler = (event) => {
            if (event.button !== undefined && event.button !== 0) return;
            const gutter = this.getResolverSidebarGutter(event.target);
            if (!gutter || typeof gutter.setPointerCapture !== 'function') return;
            try {
                gutter.setPointerCapture(event.pointerId);
            } catch {
                // Pointer capture is an optional optimization and can fail for synthetic events.
            }
        };
        this._sidebarSplitterMouseDownHandler = (event) => {
            if (event.button !== undefined && event.button !== 0) return;
            const gutter = this.getResolverSidebarGutter(event.target);
            if (gutter) this.startSidebarSplitterDragOptimization(event, gutter);
        };

        document.addEventListener('pointerdown', this._sidebarSplitterPointerDownHandler, true);
        document.addEventListener('mousedown', this._sidebarSplitterMouseDownHandler, true);
    },

    removeSidebarSplitterOptimization() {
        this.finishSidebarSplitterDragOptimization({ flush: true });
        if (this._sidebarSplitterPointerDownHandler) {
            document.removeEventListener('pointerdown', this._sidebarSplitterPointerDownHandler, true);
            this._sidebarSplitterPointerDownHandler = null;
        }
        if (this._sidebarSplitterMouseDownHandler) {
            document.removeEventListener('mousedown', this._sidebarSplitterMouseDownHandler, true);
            this._sidebarSplitterMouseDownHandler = null;
        }
    },

    getResolverSidebarGutter(target) {
        if (!this.docked || !(this.dockContainer instanceof HTMLElement) || !this.dockContainer.isConnected) {
            return null;
        }

        const element = target instanceof Element ? target : null;
        const gutter = element?.closest?.('.p-splitter-gutter');
        const panel = this.dockContainer.closest?.('[data-pc-name="splitterpanel"]');
        if (!(gutter instanceof HTMLElement) || !(panel instanceof HTMLElement)) return null;

        return gutter.previousElementSibling === panel || gutter.nextElementSibling === panel
            ? gutter
            : null;
    },

    findPrimeVueSplitterResizeOwner(gutter) {
        if (!(gutter instanceof HTMLElement)) return null;

        let instance = gutter.__vueParentComponent || gutter.parentElement?.__vueParentComponent || null;
        for (let depth = 0; instance && depth < 10; depth += 1, instance = instance.parent) {
            const owner = instance.ctx;
            if (
                owner
                && typeof owner.onResize === 'function'
                && typeof owner.onResizeStart === 'function'
            ) {
                return {
                    owner,
                    proxy: instance.proxy || owner
                };
            }
        }
        return null;
    },

    startSidebarSplitterDragOptimization(event, gutter) {
        if (this._sidebarSplitterDragState) {
            this.finishSidebarSplitterDragOptimization({ flush: true });
        }

        const resizeTarget = this.findPrimeVueSplitterResizeOwner(gutter);
        if (!resizeTarget) return false;

        const { owner, proxy } = resizeTarget;
        const originalResize = owner.onResize;
        const state = {
            owner,
            proxy,
            originalResize,
            wrappedResize: null,
            gutter,
            originalTransform: gutter.style.transform,
            originalWillChange: gutter.style.willChange,
            pendingArgs: null,
            animationFrame: null,
            delayTimer: null,
            lastLayoutAt: typeof performance === 'object' ? performance.now() : Date.now(),
            minLayoutInterval: 40,
            appliedPageX: Number(event.pageX ?? event.clientX) || 0,
            appliedPageY: Number(event.pageY ?? event.clientY) || 0,
            vertical: proxy?.horizontal === false,
            hasMoved: false,
            mouseUpHandler: null,
            blurHandler: null
        };

        state.wrappedResize = (...args) => this.queueSidebarSplitterResize(state, args);
        try {
            owner.onResize = state.wrappedResize;
        } catch {
            return false;
        }
        if (owner.onResize !== state.wrappedResize) return false;

        state.mouseUpHandler = (mouseEvent) => {
            this.finishSidebarSplitterDragOptimization({
                flush: true,
                finalEvent: mouseEvent
            });
        };
        state.blurHandler = () => this.finishSidebarSplitterDragOptimization({ flush: true });
        this._sidebarSplitterDragState = state;
        document.addEventListener('mouseup', state.mouseUpHandler, true);
        window.addEventListener('blur', state.blurHandler, { once: true });
        return true;
    },

    queueSidebarSplitterResize(state, args) {
        if (!state || this._sidebarSplitterDragState !== state) {
            return state?.originalResize?.apply(state.proxy, args);
        }

        const event = args?.[0];
        const pageX = Number(event?.pageX ?? event?.clientX);
        const pageY = Number(event?.pageY ?? event?.clientY);
        state.pendingArgs = args;
        if (!state.hasMoved) {
            state.hasMoved = true;
            state.gutter?.classList?.add('is-resizing');
            state.gutter?.parentElement?.classList?.add('is-resizing');
        }

        const offset = state.vertical
            ? pageY - state.appliedPageY
            : pageX - state.appliedPageX;
        if (Number.isFinite(offset)) {
            state.gutter.style.willChange = 'transform';
            state.gutter.style.transform = offset
                ? `translate3d(${state.vertical ? 0 : Math.round(offset)}px, ${state.vertical ? Math.round(offset) : 0}px, 0)`
                : state.originalTransform;
        }

        if (state.animationFrame || state.delayTimer) return;
        const now = typeof performance === 'object' ? performance.now() : Date.now();
        const delay = Math.max(0, state.minLayoutInterval - (now - state.lastLayoutAt));
        const requestFlush = () => {
            state.delayTimer = null;
            state.animationFrame = requestAnimationFrame(() => {
                state.animationFrame = null;
                this.flushSidebarSplitterResize(state);
            });
        };

        if (delay > 0) {
            state.delayTimer = window.setTimeout(requestFlush, delay);
        } else {
            requestFlush();
        }
    },

    flushSidebarSplitterResize(state) {
        if (!state?.pendingArgs) return false;

        const args = state.pendingArgs;
        state.pendingArgs = null;
        const event = args[0];
        state.originalResize.apply(state.proxy, args);
        state.appliedPageX = Number(event?.pageX ?? event?.clientX) || state.appliedPageX;
        state.appliedPageY = Number(event?.pageY ?? event?.clientY) || state.appliedPageY;
        state.lastLayoutAt = typeof performance === 'object' ? performance.now() : Date.now();
        state.gutter.style.transform = state.originalTransform;
        return true;
    },

    finishSidebarSplitterDragOptimization({ flush = false, finalEvent = null } = {}) {
        const state = this._sidebarSplitterDragState;
        if (!state) return false;
        this._sidebarSplitterDragState = null;

        if (state.delayTimer) {
            clearTimeout(state.delayTimer);
            state.delayTimer = null;
        }
        if (state.animationFrame) {
            cancelAnimationFrame(state.animationFrame);
            state.animationFrame = null;
        }
        if (flush && state.hasMoved && finalEvent) {
            state.pendingArgs = [finalEvent];
        }
        if (flush) this.flushSidebarSplitterResize(state);

        if (state.owner.onResize === state.wrappedResize) {
            state.owner.onResize = state.originalResize;
        }
        state.gutter.style.transform = state.originalTransform;
        state.gutter.style.willChange = state.originalWillChange;
        state.gutter?.classList?.remove('is-resizing');
        state.gutter?.parentElement?.classList?.remove('is-resizing');
        document.removeEventListener('mouseup', state.mouseUpHandler, true);
        window.removeEventListener('blur', state.blurHandler);
        return true;
    },

    dockToSidebar() {
        if (this.docked) return;

        this.rememberSidebarOpenMode('docked');
        this.pendingDockToSidebar = true;

        if (this.isUsableDockContainer(this.lastDockContainer)) {
            this.dockTo(this.lastDockContainer);
            return;
        }

        this.tryOpenComfySidebarState();

        requestAnimationFrame(() => {
            if (!this.pendingDockToSidebar || this.docked) return;

            const button = document.querySelector(`.${this.sidebarTabId}-tab-button`);
            if (button instanceof HTMLElement) {
                const isActive = button.matches([
                    '[aria-pressed="true"]',
                    '[aria-selected="true"]',
                    '[data-active="true"]',
                    '[data-selected="true"]',
                    '.active',
                    '.is-active',
                    '.selected',
                    '.p-highlight'
                ].join(','));

                if (!isActive) {
                    button.click();
                }
            }
        });
    },

    isUsableDockContainer(container) {
        if (!(container instanceof HTMLElement) || !container.isConnected) return false;

        const style = getComputedStyle(container);
        if (style.display === 'none' || style.visibility === 'hidden') return false;

        const rect = container.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    },

    trySetSidebarStateProperty(target, property, value) {
        try {
            if (!(property in target)) return false;
            return Reflect.set(target, property, value);
        } catch (error) {
            return false;
        }
    },

    tryOpenComfySidebarState() {
        const extensionManager = app.extensionManager;
        let opened = false;
        const candidates = [
            extensionManager?.sidebarTab,
            extensionManager?.sidebarTabs,
            extensionManager?.sidebar,
            extensionManager
        ].filter(Boolean);

        for (const candidate of candidates) {
            try {
                if (typeof candidate.openSidebar === 'function') {
                    candidate.openSidebar(this.sidebarTabId);
                    opened = true;
                }
                if (typeof candidate.openSidebarTab === 'function') {
                    candidate.openSidebarTab(this.sidebarTabId);
                    opened = true;
                }
                if (typeof candidate.setActiveSidebarTab === 'function') {
                    candidate.setActiveSidebarTab(this.sidebarTabId);
                    opened = true;
                }
                if (typeof candidate.setActiveSidebarTabId === 'function') {
                    candidate.setActiveSidebarTabId(this.sidebarTabId);
                    opened = true;
                }
                if (this.trySetSidebarStateProperty(candidate, 'activeSidebarTabId', this.sidebarTabId)) {
                    opened = true;
                }
            } catch (error) {
                // Sidebar internals differ between ComfyUI versions; unsupported state APIs are ignored.
            }
        }

        return opened;
    },

    undockToFloating({ persist = true, closeSidebar = true } = {}) {
        if (!this.element) return;

        this.removeSidebarSplitterOptimization();
        this.setDockDropPreviewActive(false);
        this.setUndockDropPreviewActive(false);
        this._pendingDragDockRect = null;
        const wasDocked = this.docked;
        const dockContainer = this.dockContainer;
        if (wasDocked) {
            this.rememberDockDropPreviewWidth(dockContainer);
        }
        this.docked = false;
        this.dockContainer = null;
        this.element.classList.remove('mr-is-docked');
        this.clearModalPlacementStyles();

        if (this.element.parentNode !== document.body) {
            document.body.appendChild(this.element);
        }

        this.element.style.display = 'flex';
        this.restoreFloatingGeometry();
        this.ensureModalHandleInViewport({ persist });

        if (wasDocked && closeSidebar) {
            this.closeComfySidebar(dockContainer);
        }
    },

    closeComfySidebar(dockContainer = null) {
        const closedByState = this.tryCloseComfySidebarState();

        requestAnimationFrame(() => {
            if (dockContainer && !dockContainer.isConnected) return;

            const button = document.querySelector(`.${this.sidebarTabId}-tab-button`);
            if (!(button instanceof HTMLElement)) return;

            const isActive = button.matches([
                '[aria-pressed="true"]',
                '[aria-selected="true"]',
                '[data-active="true"]',
                '[data-selected="true"]',
                '.active',
                '.is-active',
                '.selected',
                '.p-highlight'
            ].join(','));

            if (!closedByState || isActive) {
                button.click();
            }
        });
    },

    tryCloseComfySidebarState() {
        const extensionManager = app.extensionManager;
        let closed = false;
        const candidates = [
            extensionManager?.sidebarTab,
            extensionManager?.sidebarTabs,
            extensionManager?.sidebar,
            extensionManager
        ].filter(Boolean);

        for (const candidate of candidates) {
            try {
                if (typeof candidate.closeSidebar === 'function') {
                    candidate.closeSidebar();
                    closed = true;
                }
                if (typeof candidate.closeSidebarTab === 'function') {
                    candidate.closeSidebarTab(this.sidebarTabId);
                    closed = true;
                }
                if (typeof candidate.setActiveSidebarTab === 'function') {
                    candidate.setActiveSidebarTab(null);
                    closed = true;
                }
                if (typeof candidate.setActiveSidebarTabId === 'function') {
                    candidate.setActiveSidebarTabId(null);
                    closed = true;
                }
                if (
                    this.trySetSidebarStateProperty(candidate, 'activeSidebarTabId', null) ||
                    this.trySetSidebarStateProperty(candidate, 'activeSidebarTab', null)
                ) {
                    closed = true;
                }
            } catch (error) {
                // Sidebar internals differ between ComfyUI versions; unsupported state APIs are ignored.
            }
        }

        return closed;
    },

    // Toggle full screen mode for the dialog
    toggleFullScreen() {
        this.setFullScreen(!this.fullscreen);
    },

    setFullScreen(enable) {
        const shouldReturnToDocked = !enable && this.returnToDockedAfterFullscreen;
        if (enable && this.docked) {
            this.returnToDockedAfterFullscreen = true;
            this.undockToFloating({ persist: false });
        } else if (enable) {
            this.returnToDockedAfterFullscreen = false;
        }

        this.fullscreen = !!enable;
        const el = this.element;
        if (!el) return;
        const btn = document.getElementById('model-resolver-fullscreen-toggle');
        if (enable) {
            // Save current size
            const rect = el.getBoundingClientRect();
            safeStorage.setItem('model_resolver_modal_size_before_fs', JSON.stringify({ w: Math.round(rect.width), h: Math.round(rect.height) }));
            el.style.top = '0';
            el.style.left = '0';
            el.style.transform = 'none';
            el.style.width = '100vw';
            el.style.height = '100vh';
            el.style.maxWidth = '100vw';
            el.style.maxHeight = '100vh';
            el.style.borderRadius = '0';
            el.style.resize = 'none';
            if (btn) {
                btn.innerHTML = getSvgIcon('windowRestore', 'currentColor', 'mr-window-btn-icon');
                btn.setAttribute('aria-label', 'Exit full screen');
                this.setTooltip(btn, 'Exit full screen');
            }
            safeStorage.setItem('model_resolver_modal_fullscreen', '1');
        } else {
            this.returnToDockedAfterFullscreen = false;
            // Restore centered sizing
            el.style.maxWidth = '100vw';
            el.style.maxHeight = '100vh';
            el.style.borderRadius = '8px';
            el.style.resize = 'both';
            // Restore saved pre-FS size if available
            let wh = null;
            try { wh = JSON.parse(safeStorage.getItem('model_resolver_modal_size_before_fs') || 'null'); } catch (e) {}
            if (wh && wh.w && wh.h) {
                el.style.width = `${wh.w}px`;
                el.style.height = `${wh.h}px`;
            } else {
                el.style.width = '1100px';
                el.style.height = '700px';
            }
            // Restore last known position if available, else center
            const pos = JSON.parse(safeStorage.getItem('model_resolver_modal_pos') || 'null');
            if (pos && Number.isFinite(pos.top) && Number.isFinite(pos.left)) {
                el.style.top = `${pos.top}px`;
                el.style.left = `${pos.left}px`;
                el.style.transform = 'none';
            } else {
                el.style.top = '50%';
                el.style.left = '50%';
                el.style.transform = 'translate(-50%, -50%)';
            }
            if (btn) {
                btn.innerHTML = getSvgIcon('windowMaximize', 'currentColor', 'mr-window-btn-icon');
                btn.setAttribute('aria-label', 'Enter full screen');
                this.setTooltip(btn, 'Enter full screen');
            }
            this.ensureModalHandleInViewport({ persist: true });
            safeStorage.setItem('model_resolver_modal_fullscreen', '0');

            if (shouldReturnToDocked) {
                this.dockToSidebar();
            }
        }
    },

    getViewportClampedModalPosition(top, left) {
        const el = this.element;
        if (!el) return { top, left };

        const vw = window.innerWidth || document.documentElement.clientWidth || 0;
        const vh = window.innerHeight || document.documentElement.clientHeight || 0;
        const pad = 4;
        const handle = document.getElementById('model-resolver-drag-handle');

        if (handle) {
            const elRect = el.getBoundingClientRect();
            const handleRect = handle.getBoundingClientRect();
            const handleOffsetLeft = handleRect.left - elRect.left;
            const handleOffsetTop = handleRect.top - elRect.top;
            const handleWidth = handleRect.width || handle.offsetWidth;
            const handleHeight = handleRect.height || handle.offsetHeight;
            const minLeft = pad - handleOffsetLeft;
            const maxLeft = vw - pad - handleOffsetLeft - handleWidth;
            const minTop = pad - handleOffsetTop;
            const maxTop = vh - pad - handleOffsetTop - handleHeight;

            left = Math.max(minLeft, Math.min(maxLeft, left));
            top = Math.max(minTop, Math.min(maxTop, top));
        } else {
            const w = el.offsetWidth;
            const h = el.offsetHeight;
            left = Math.max(-w + pad, Math.min(vw - pad, left));
            top = Math.max(-h + pad, Math.min(vh - pad, top));
        }

        return { top, left };
    },

    saveModalPosition(position = null) {
        if (this.docked) return;

        const el = this.element;
        if (!el) return;
        const top = Number(position?.top);
        const left = Number(position?.left);
        if (Number.isFinite(top) && Number.isFinite(left)) {
            safeStorage.setItem('model_resolver_modal_pos', JSON.stringify({
                top: Math.round(top),
                left: Math.round(left)
            }));
            return;
        }

        const rect = el.getBoundingClientRect();
        safeStorage.setItem('model_resolver_modal_pos', JSON.stringify({
            top: Math.round(rect.top),
            left: Math.round(rect.left)
        }));
    },

    ensureModalHandleInViewport({ persist = false } = {}) {
        if (this.docked) return;
        if (this.fullscreen) return;
        const el = this.element;
        if (!el || !this.isVisible()) return;

        const rect = el.getBoundingClientRect();
        const { top, left } = this.getViewportClampedModalPosition(rect.top, rect.left);
        const nextTop = Math.round(top);
        const nextLeft = Math.round(left);

        if (Math.round(rect.top) === nextTop && Math.round(rect.left) === nextLeft) return;

        el.style.top = `${nextTop}px`;
        el.style.left = `${nextLeft}px`;
        el.style.transform = 'none';

        if (persist) this.saveModalPosition();
    },

    scheduleModalViewportClamp(persist = false) {
        if (this._viewportClampFrame) {
            cancelAnimationFrame(this._viewportClampFrame);
        }

        this._viewportClampFrame = requestAnimationFrame(() => {
            this._viewportClampFrame = null;
            this.ensureModalHandleInViewport({ persist });
        });
    },

    getDockSnapThreshold() {
        const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
        return Math.max(40, Math.min(64, viewportWidth * 0.045));
    },

    rememberDockDropPreviewWidth(container = this.lastDockContainer) {
        if (!(container instanceof HTMLElement) || !container.isConnected) return;

        const width = container.getBoundingClientRect().width;
        if (Number.isFinite(width) && width > 0) {
            this._lastDockContainerWidth = Math.round(width);
        }
    },

    updateDockDropPreviewWidth() {
        this.rememberDockDropPreviewWidth();
        if (!this.dockDropPreview) return;

        const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
        const availableWidth = Math.max(0, viewportWidth - 16);
        const width = Math.min(Number(this._lastDockContainerWidth) || 0, availableWidth);
        if (width > 0) {
            this.dockDropPreview.style.width = `${Math.round(width)}px`;
        } else {
            this.dockDropPreview.style.removeProperty('width');
        }
    },

    setDockDropPreviewActive(active) {
        const nextActive = Boolean(active && !this.docked && !this.fullscreen);
        if (this._dragDockCandidate === nextActive) return;

        this._dragDockCandidate = nextActive;
        this.dockDropPreview?.classList.toggle('is-active', nextActive);
        this.dockDropPreview?.setAttribute('aria-hidden', nextActive ? 'false' : 'true');
    },

    getRememberedFloatingSize() {
        const rememberedRect = this._floatingRectBeforeDock;
        if (rememberedRect?.width > 0 && rememberedRect?.height > 0) {
            return {
                width: rememberedRect.width,
                height: rememberedRect.height
            };
        }

        let storedSize;
        try {
            storedSize = JSON.parse(safeStorage.getItem('model_resolver_modal_size_before_fs') || 'null');
        } catch {
            storedSize = null;
        }

        return {
            width: Number(storedSize?.w) || 1100,
            height: Number(storedSize?.h) || 700
        };
    },

    getDockedDragPreviewRect(clientX, clientY) {
        const start = this._dockedDragStart;
        if (!start) return null;

        const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
        const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
        const width = Math.min(Math.max(start.width, 640), viewportWidth);
        const height = Math.min(Math.max(start.height, 420), viewportHeight);
        const maxLeft = Math.max(0, viewportWidth - width);
        const maxTop = Math.max(0, viewportHeight - height);
        const left = Math.max(0, Math.min(maxLeft, clientX - start.pointerOffsetLeft));
        const top = Math.max(0, Math.min(maxTop, clientY - start.pointerOffsetTop));

        return {
            top: Math.round(top),
            left: Math.round(left),
            width: Math.round(width),
            height: Math.round(height)
        };
    },

    setUndockDropPreviewActive(active) {
        const nextActive = Boolean(active && this.docked && !this.fullscreen);
        if (this._dragUndockCandidate === nextActive) return;

        this._dragUndockCandidate = nextActive;
        this.undockDropPreview?.classList.toggle('is-active', nextActive);
        this.undockDropPreview?.setAttribute('aria-hidden', nextActive ? 'false' : 'true');
    },

    startDockedDrag(e) {
        const el = this.element;
        if (!el || !this.docked || this.fullscreen) return;

        e.preventDefault?.();
        this.setDockDropPreviewActive(false);
        this.setUndockDropPreviewActive(false);

        const rect = el.getBoundingClientRect();
        const size = this.getRememberedFloatingSize();
        this._dockedDragStart = {
            x: e.clientX,
            y: e.clientY,
            pointerOffsetLeft: Math.max(0, e.clientX - rect.left),
            pointerOffsetTop: Math.max(0, e.clientY - rect.top),
            width: size.width,
            height: size.height
        };
        this._dockedDragPendingRect = this.getDockedDragPreviewRect(e.clientX, e.clientY);

        if (this.undockDropPreview && this._dockedDragPendingRect) {
            this.undockDropPreview.style.width = `${this._dockedDragPendingRect.width}px`;
            this.undockDropPreview.style.height = `${this._dockedDragPendingRect.height}px`;
            this.undockDropPreview.style.transform = `translate3d(${this._dockedDragPendingRect.left}px, ${this._dockedDragPendingRect.top}px, 0)`;
            this.undockDropPreview.style.willChange = 'transform';
        }

        this._onMouseMove = (ev) => this.onDockedDrag(ev);
        this._onMouseUp = () => this.endDockedDrag();
        document.addEventListener('mousemove', this._onMouseMove);
        document.addEventListener('mouseup', this._onMouseUp, { once: true });
    },

    onDockedDrag(e) {
        const start = this._dockedDragStart;
        if (!start) return;

        const dx = e.clientX - start.x;
        const dy = e.clientY - start.y;
        if (!this._dragUndockCandidate && Math.hypot(dx, dy) < 5) return;

        this._dockedDragPendingRect = this.getDockedDragPreviewRect(e.clientX, e.clientY);
        this.setUndockDropPreviewActive(true);
        if (this._dockedDragAnimationFrame || !this._dockedDragPendingRect) return;

        this._dockedDragAnimationFrame = requestAnimationFrame(() => {
            this._dockedDragAnimationFrame = null;
            if (!this._dragUndockCandidate || !this._dockedDragPendingRect || !this.undockDropPreview) return;

            const { left, top } = this._dockedDragPendingRect;
            this.undockDropPreview.style.transform = `translate3d(${left}px, ${top}px, 0)`;
        });
    },

    endDockedDrag() {
        if (!this._dockedDragStart) return;

        const shouldUndock = this._dragUndockCandidate;
        const finalRect = shouldUndock ? this._dockedDragPendingRect : null;
        document.removeEventListener('mousemove', this._onMouseMove);
        this.setUndockDropPreviewActive(false);

        if (this._dockedDragAnimationFrame) {
            cancelAnimationFrame(this._dockedDragAnimationFrame);
            this._dockedDragAnimationFrame = null;
        }

        if (this.undockDropPreview) {
            this.undockDropPreview.style.willChange = '';
        }
        this._dockedDragStart = null;
        this._dockedDragPendingRect = null;

        if (finalRect) {
            this.undockToFloating({ persist: false });
            this.element.style.width = `${finalRect.width}px`;
            this.element.style.height = `${finalRect.height}px`;
            this.element.style.top = `${finalRect.top}px`;
            this.element.style.left = `${finalRect.left}px`;
            this.element.style.transform = 'none';
            this._floatingRectBeforeDock = { ...finalRect };
            this.saveModalPosition(finalRect);
        }
    },

    // Begin window drag
    startDrag(e) {
        if (this.docked) {
            this.startDockedDrag(e);
            return;
        }

        try {
            const el = this.element;
            if (!el) return;
            e.preventDefault?.();
            if (this._dragLayerCleanupTimer) {
                clearTimeout(this._dragLayerCleanupTimer);
                this._dragLayerCleanupTimer = null;
            }
            this._pendingDragDockRect = null;
            this.setDockDropPreviewActive(false);
            this.updateDockDropPreviewWidth();
            const rect = el.getBoundingClientRect();
            const vw = window.innerWidth || document.documentElement.clientWidth || 0;
            const vh = window.innerHeight || document.documentElement.clientHeight || 0;
            const pad = 4;
            const handle = document.getElementById('model-resolver-drag-handle');

            if (handle) {
                const handleRect = handle.getBoundingClientRect();
                const handleOffsetLeft = handleRect.left - rect.left;
                const handleOffsetTop = handleRect.top - rect.top;
                const handleWidth = handleRect.width || handle.offsetWidth;
                const handleHeight = handleRect.height || handle.offsetHeight;
                this._dragBounds = {
                    minLeft: pad - handleOffsetLeft,
                    maxLeft: vw - pad - handleOffsetLeft - handleWidth,
                    minTop: pad - handleOffsetTop,
                    maxTop: vh - pad - handleOffsetTop - handleHeight
                };
            } else {
                this._dragBounds = {
                    minLeft: -rect.width + pad,
                    maxLeft: vw - pad,
                    minTop: -rect.height + pad,
                    maxTop: vh - pad
                };
            }

            // Switch to absolute top/left (no transform) before dragging
            el.style.top = `${rect.top}px`;
            el.style.left = `${rect.left}px`;
            el.style.transform = 'none';
            el.style.willChange = 'transform';
            this._dragging = true;
            this._dragStart = {
                x: e.clientX,
                y: e.clientY,
                top: rect.top,
                left: rect.left,
                width: rect.width,
                height: rect.height
            };
            this._dragPendingPosition = {
                top: Math.round(rect.top),
                left: Math.round(rect.left)
            };
            // Attach listeners
            this._onMouseMove = (ev) => this.onDrag(ev);
            this._onMouseUp = () => this.endDrag();
            document.addEventListener('mousemove', this._onMouseMove);
            document.addEventListener('mouseup', this._onMouseUp, { once: true });
        } catch (err) { /* ignore */ }
    },

    onDrag(e) {
        if (!this._dragging || !this._dragStart) return;
        const el = this.element;
        if (!el) return;
        const dx = e.clientX - this._dragStart.x;
        const dy = e.clientY - this._dragStart.y;
        let top = this._dragStart.top + dy;
        let left = this._dragStart.left + dx;
        const bounds = this._dragBounds;
        if (bounds) {
            left = Math.max(bounds.minLeft, Math.min(bounds.maxLeft, left));
            top = Math.max(bounds.minTop, Math.min(bounds.maxTop, top));
        }

        this._dragPendingPosition = {
            top: Math.round(top),
            left: Math.round(left)
        };
        this.setDockDropPreviewActive(e.clientX <= this.getDockSnapThreshold());
        if (this._dragAnimationFrame) return;

        this._dragAnimationFrame = requestAnimationFrame(() => {
            this._dragAnimationFrame = null;
            if (!this._dragging || !this._dragStart || !this._dragPendingPosition) return;

            const translateX = this._dragPendingPosition.left - this._dragStart.left;
            const translateY = this._dragPendingPosition.top - this._dragStart.top;
            el.style.transform = `translate3d(${translateX}px, ${translateY}px, 0)`;
        });
    },

    endDrag() {
        if (!this._dragging) return;
        const shouldDock = this._dragDockCandidate;
        this._dragging = false;
        document.removeEventListener('mousemove', this._onMouseMove);
        this.setDockDropPreviewActive(false);

        if (this._dragAnimationFrame) {
            cancelAnimationFrame(this._dragAnimationFrame);
            this._dragAnimationFrame = null;
        }

        const el = this.element;
        const finalPosition = this._dragPendingPosition || this._dragStart;
        if (shouldDock && finalPosition && this._dragStart) {
            this._pendingDragDockRect = {
                top: Math.round(finalPosition.top),
                left: Math.round(finalPosition.left),
                width: this._dragStart.width,
                height: this._dragStart.height
            };
        }
        if (el && finalPosition) {
            el.style.top = `${Math.round(finalPosition.top)}px`;
            el.style.left = `${Math.round(finalPosition.left)}px`;
            el.style.transform = 'none';
        }

        this._dragStart = null;
        this._dragBounds = null;
        this._dragPendingPosition = null;
        // Persist position
        this.saveModalPosition(finalPosition);

        this._dragLayerCleanupTimer = setTimeout(() => {
            this._dragLayerCleanupTimer = null;
            if (!this._dragging && this.element) {
                this.element.style.willChange = '';
            }
        }, 120);

        if (shouldDock) {
            this.dockToSidebar();
        }
    },

    /**
     * Simple debounce helper
     */
    debounce(callback, wait = 250) {
        let t = null;
        return (...args) => {
            if (t) clearTimeout(t);
            t = setTimeout(() => {
                callback.apply(this, args);
            }, wait);
        };
    }
};
