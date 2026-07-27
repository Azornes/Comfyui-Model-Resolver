/**
 * Helper to initiate a splitter drag interaction.
 * Handles mouse/pointer event listening, touch/cancellation, and RAF throttling.
 */
export function startSplitterDrag(event, {
    anchor = 'right',
    startWidth,
    bounds = { min: 100, max: 800 },
    dragThreshold = 0,
    layoutFrameStride = 1,
    onBeforeDrag = null,
    onPreview = null,
    onDrag = () => {},
    onEnd = () => {}
}) {
    if (event?.button !== undefined && event.button !== 0) return null;
    event?.preventDefault?.();
    event?.stopPropagation?.();

    const startX = event.clientX;
    const movementThreshold = Math.max(0, Number(dragThreshold) || 0);
    const frameStride = Math.max(1, Math.round(Number(layoutFrameStride) || 1));
    let pendingWidth = startWidth;
    let appliedWidth = startWidth;
    let animationFrame = null;
    let isDragging = true;
    let didDrag = false;
    let frameCount = 0;

    const moveEvent = event?.type === 'pointerdown' ? 'pointermove' : 'mousemove';
    const upEvent = event?.type === 'pointerdown' ? 'pointerup' : 'mouseup';
    const cancelEvent = event?.type === 'pointerdown' ? 'pointercancel' : null;

    const scheduleFrame = () => {
        if (animationFrame) return;
        animationFrame = requestAnimationFrame(() => {
            animationFrame = null;
            if (!isDragging) return;

            frameCount += 1;
            const shouldApplyLayout = frameCount % frameStride === 0;
            if (shouldApplyLayout && pendingWidth !== appliedWidth) {
                onDrag(pendingWidth);
                appliedWidth = pendingWidth;
            }

            onPreview?.(pendingWidth, appliedWidth, {
                didApplyLayout: shouldApplyLayout,
                final: false
            });

            if (pendingWidth !== appliedWidth) {
                scheduleFrame();
            }
        });
    };

    const handleMove = (e) => {
        if (!isDragging) return;
        e?.preventDefault?.();
        e?.stopPropagation?.();

        const dx = e.clientX - startX;
        if (!didDrag && Math.abs(dx) < movementThreshold) return;
        didDrag = true;
        let newWidth = anchor === 'right' ? startWidth - dx : startWidth + dx;

        if (onBeforeDrag) {
            newWidth = onBeforeDrag(newWidth);
        } else {
            if (newWidth < bounds.min) newWidth = bounds.min;
            if (newWidth > bounds.max) newWidth = bounds.max;
        }

        const nextWidth = Math.round(newWidth);
        if (nextWidth === pendingWidth) return;
        pendingWidth = nextWidth;
        scheduleFrame();
    };

    const handleUp = (e) => {
        if (!isDragging) return;
        e?.preventDefault?.();
        e?.stopPropagation?.();

        isDragging = false;

        document.removeEventListener(moveEvent, handleMove, true);
        document.removeEventListener(upEvent, handleUp, true);
        if (cancelEvent) {
            document.removeEventListener(cancelEvent, handleUp, true);
        }

        if (animationFrame) {
            cancelAnimationFrame(animationFrame);
            animationFrame = null;
        }

        if (didDrag) {
            onPreview?.(pendingWidth, pendingWidth, {
                didApplyLayout: pendingWidth === appliedWidth,
                final: true
            });
        }
        onEnd(pendingWidth, { didDrag, appliedWidth });
    };

    document.addEventListener(moveEvent, handleMove, true);
    document.addEventListener(upEvent, handleUp, { once: true, capture: true });
    if (cancelEvent) {
        document.addEventListener(cancelEvent, handleUp, { once: true, capture: true });
    }

    return {
        cancel: () => {
            isDragging = false;
            document.removeEventListener(moveEvent, handleMove, true);
            document.removeEventListener(upEvent, handleUp, true);
            if (cancelEvent) {
                document.removeEventListener(cancelEvent, handleUp, true);
            }
            if (animationFrame) {
                cancelAnimationFrame(animationFrame);
                animationFrame = null;
            }
            if (didDrag) {
                onPreview?.(appliedWidth, appliedWidth, {
                    cancelled: true,
                    final: true
                });
            }
        }
    };
}
