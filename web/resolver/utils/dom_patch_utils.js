const boundEventKeys = new WeakMap();

export function syncElementAttributes(current, next) {
    if (!current || !next) return current;

    const nextAttributeNames = new Set(
        Array.from(next.attributes || [], attribute => attribute.name)
    );
    for (const attribute of Array.from(current.attributes || [])) {
        if (!nextAttributeNames.has(attribute.name)) {
            current.removeAttribute(attribute.name);
        }
    }
    for (const attribute of Array.from(next.attributes || [])) {
        if (current.getAttribute(attribute.name) !== attribute.value) {
            current.setAttribute(attribute.name, attribute.value);
        }
    }
    return current;
}

export function setTextIfChanged(element, value) {
    if (!element) return false;
    const nextText = String(value ?? '');
    if (element.textContent === nextText) return false;
    element.textContent = nextText;
    return true;
}

export function bindEventOnce(element, eventName, handler, key = eventName) {
    if (!element?.addEventListener || !eventName || typeof handler !== 'function') return false;

    let elementKeys = boundEventKeys.get(element);
    if (!elementKeys) {
        elementKeys = new Set();
        boundEventKeys.set(element, elementKeys);
    }

    const bindingKey = `${eventName}:${String(key)}`;
    if (elementKeys.has(bindingKey)) return false;
    elementKeys.add(bindingKey);
    element.addEventListener(eventName, handler);
    return true;
}

export function bindInstantAction(button, handler) {
    if (!button || button._hasListener) return false;
    button._hasListener = true;
    const run = (event) => {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        if (button.disabled) return;
        if (event?.type === 'click' && button._handledPointerAction) {
            button._handledPointerAction = false;
            return;
        }
        if (event?.type === 'pointerdown') {
            button._handledPointerAction = true;
        }
        handler(event);
    };
    button.addEventListener('pointerdown', run);
    button.addEventListener('click', run);
    return true;
}
