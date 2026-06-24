export function clampNumber(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

export function createFloatingTreePicker({
    listEl,
    anchorEl,
    duplicateSelector = '',
    floatingClass = 'mr-download-target-floating',
    browserClass = '',
    scrollSelector = '.mr-folder-browser-scroll',
    viewportPadding = 12,
    gap = 6,
    minViewportWidth = 320,
    minViewportHeight = 240,
    minAvailableWidth = 260,
    minPopupWidth = 420,
    maxPopupWidth = 560,
    openAboveThreshold = 260,
    minAvailableHeight = 0,
    minScrollHeight = 0,
    setMinWidth = false,
    roundValues = false,
    onHide = null
} = {}) {
    const cleanup = () => {
        if (typeof listEl?._mlFloatingPositionCleanup === 'function') {
            listEl._mlFloatingPositionCleanup();
            listEl._mlFloatingPositionCleanup = null;
        }
    };

    const hide = () => {
        if (!listEl) return;
        cleanup();
        listEl.style.display = 'none';
        if (typeof onHide === 'function') onHide();
    };

    const portal = () => {
        if (!listEl) return;
        if (duplicateSelector) {
            document.querySelectorAll(duplicateSelector).forEach(existing => {
                if (existing !== listEl && (!listEl.id || existing.id === listEl.id)) {
                    existing.remove();
                }
            });
        }
        if (listEl.dataset.mlFloatingPortal !== 'true') {
            listEl.dataset.mlFloatingPortal = 'true';
            document.body.appendChild(listEl);
        }
        if (floatingClass) listEl.classList.add(floatingClass);
        if (browserClass) listEl.classList.add(browserClass);
    };

    const format = (value) => `${roundValues ? Math.round(value) : value}px`;

    const position = () => {
        if (!listEl || !anchorEl || listEl.style.display === 'none') return;

        const rect = anchorEl.getBoundingClientRect();
        const viewportWidth = Math.max(minViewportWidth, window.innerWidth || document.documentElement.clientWidth || 0);
        const viewportHeight = Math.max(minViewportHeight, window.innerHeight || document.documentElement.clientHeight || 0);
        if (rect.bottom < viewportPadding || rect.top > viewportHeight - viewportPadding) {
            hide();
            return;
        }

        const availableWidth = Math.max(minAvailableWidth, viewportWidth - viewportPadding * 2);
        const targetWidth = Math.min(maxPopupWidth, availableWidth, Math.max(rect.width, minPopupWidth));
        const left = clampNumber(
            rect.left,
            viewportPadding,
            Math.max(viewportPadding, viewportWidth - targetWidth - viewportPadding)
        );
        const spaceBelow = viewportHeight - rect.bottom - viewportPadding - gap;
        const spaceAbove = rect.top - viewportPadding - gap;
        const openAbove = spaceBelow < openAboveThreshold && spaceAbove > spaceBelow;
        const availableHeight = Math.max(minAvailableHeight, openAbove ? spaceAbove : spaceBelow);

        listEl.style.position = 'fixed';
        listEl.style.left = format(left);
        listEl.style.right = 'auto';
        listEl.style.width = format(targetWidth);
        if (setMinWidth) {
            listEl.style.minWidth = format(Math.min(rect.width, targetWidth));
        }
        listEl.style.maxWidth = format(availableWidth);
        listEl.style.maxHeight = format(availableHeight);

        const scrollEl = listEl.querySelector(scrollSelector);
        if (scrollEl) {
            scrollEl.style.height = '';
            scrollEl.style.maxHeight = '';
            const containerStyle = window.getComputedStyle(listEl);
            const containerChromeHeight = [
                containerStyle.borderTopWidth,
                containerStyle.borderBottomWidth,
                containerStyle.paddingTop,
                containerStyle.paddingBottom
            ].reduce((height, value) => height + (Number.parseFloat(value) || 0), 0);
            const chromeHeight = Array.from(listEl.children).reduce((height, child) => {
                if (child === scrollEl) return height;
                const style = window.getComputedStyle(child);
                return height
                    + child.offsetHeight
                    + (Number.parseFloat(style.marginTop) || 0)
                    + (Number.parseFloat(style.marginBottom) || 0);
            }, 0);
            const scrollHeight = Math.max(minScrollHeight, availableHeight - chromeHeight - containerChromeHeight);
            scrollEl.style.maxHeight = format(scrollHeight);
        }

        const popupHeight = Math.min(listEl.offsetHeight || availableHeight, availableHeight);
        const top = openAbove
            ? clampNumber(rect.top - popupHeight - gap, viewportPadding, Math.max(viewportPadding, viewportHeight - viewportPadding - popupHeight))
            : clampNumber(rect.bottom + gap, viewportPadding, Math.max(viewportPadding, viewportHeight - viewportPadding - popupHeight));
        listEl.style.top = format(top);
    };

    const bindPositioning = () => {
        cleanup();
        const updatePosition = (event) => {
            if (event?.type === 'scroll' && event.target instanceof Node && listEl?.contains(event.target)) {
                return;
            }
            position();
        };
        window.addEventListener('resize', updatePosition, true);
        window.addEventListener('scroll', updatePosition, true);
        listEl._mlFloatingPositionCleanup = () => {
            window.removeEventListener('resize', updatePosition, true);
            window.removeEventListener('scroll', updatePosition, true);
        };
    };

    const show = () => {
        if (!listEl) return;
        portal();
        listEl.style.display = 'block';
        position();
        bindPositioning();
        requestAnimationFrame(position);
    };

    return {
        cleanup,
        hide,
        portal,
        position,
        bindPositioning,
        show
    };
}
