export function serializeKeybindingCombo(combo = {}) {
    return [
        String(combo.key || "").toUpperCase(),
        String(Boolean(combo.ctrl)),
        String(Boolean(combo.alt)),
        String(Boolean(combo.shift)),
    ].join(":");
}

export function keybindingsEqual(left, right) {
    return Boolean(
        left
        && right
        && left.commandId === right.commandId
        && (left.targetElementId || "") === (right.targetElementId || "")
        && serializeKeybindingCombo(left.combo) === serializeKeybindingCombo(right.combo)
    );
}

export function getComboLabel(combo = {}) {
    const parts = [];
    if (combo.ctrl) parts.push("Ctrl");
    if (combo.alt) parts.push("Alt");
    if (combo.shift) parts.push("Shift");

    const keyLabels = {
        " ": "Space",
        ArrowUp: "Up",
        ArrowDown: "Down",
        ArrowLeft: "Left",
        ArrowRight: "Right",
        Backspace: "Backspace",
        Delete: "Delete",
        Enter: "Enter",
        Escape: "Esc",
        Tab: "Tab",
    };
    const key = String(combo.key || "").trim();
    if (key) {
        parts.push(keyLabels[key] || (key.length === 1 ? key.toUpperCase() : key));
    }

    return parts.join("+");
}
