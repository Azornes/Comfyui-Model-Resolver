import { bindInstantAction } from "./dom_patch_utils.js";

function bindClickAction(button, handler) {
    if (!button || button._hasListener) return false;
    button._hasListener = true;
    button.addEventListener('click', (event) => {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        if (button.disabled) return;
        handler(event);
    });
    return true;
}

function bindActionButtons(root, selector, handler) {
    if (!selector) return;
    root.querySelectorAll(selector).forEach((button) => {
        bindInstantAction(button, (event) => handler(button, event));
    });
}

export function bindDownloadActionHandlers(root, {
    fallbackDownloadId = '',
    getDownloadId = button => button?.dataset?.downloadId || fallbackDownloadId,
    getContext = null,
    selectors = {},
    onCancel = null,
    onPause = null,
    onResume = null,
    onOpenFolder = null,
    onSwitchWorkflow = null,
    onMore = null,
    moreBinding = 'instant',
} = {}) {
    if (!root?.querySelectorAll) return;

    const resolveDownloadId = button => getDownloadId(button) || '';
    const resolveContext = button => getContext?.(button, resolveDownloadId(button)) || null;
    const bindIdAction = (selector, action) => {
        if (!action) return;
        bindActionButtons(root, selector, (button) => {
            const downloadId = resolveDownloadId(button);
            if (downloadId) action(downloadId);
        });
    };

    bindIdAction(selectors.cancel, onCancel);
    bindIdAction(selectors.pause, onPause);
    bindIdAction(selectors.resume, onResume);

    bindActionButtons(root, selectors.openFolder, (button) => {
        const context = resolveContext(button);
        if (context) onOpenFolder?.(context);
    });
    bindActionButtons(root, selectors.switchWorkflow, (button) => {
        const context = resolveContext(button);
        if (context) onSwitchWorkflow?.(context);
    });

    if (selectors.more && onMore) {
        const bindMore = moreBinding === 'click' ? bindClickAction : bindInstantAction;
        root.querySelectorAll(selectors.more).forEach((button) => {
            bindMore(button, event => onMore(event, button, resolveDownloadId(button)));
        });
    }
}
