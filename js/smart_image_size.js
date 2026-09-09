import { app } from "../../scripts/app.js";

const NODE_TYPE = "wzq_image_out";
const MODES = {
    blank: "创建空白图",
    scale: "缩放输入图",
};

function widgetValue(node, name, fallback) {
    return node.widgets?.find((widget) => widget.name === name)?.value ?? fallback;
}

function targetSize(ratio, megapixels, multiple) {
    const pixels = Math.max(0.01, Number(megapixels) || 0.01) * 1024 * 1024;
    const safeRatio = Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
    const step = Math.max(1, Math.round(Number(multiple) || 1));
    // Python's round() uses ties-to-even; mirror it so the preview and backend
    // agree at exact half-step boundaries, as ComfyUI's built-in preview does.
    const roundHalfToEven = (value) => {
        const lower = Math.floor(value);
        return value - lower === 0.5 ? (lower % 2 === 0 ? lower : lower + 1) : Math.round(value);
    };
    const round = (value) => Math.max(step, roundHalfToEven(value / step) * step);
    const idealWidth = Math.sqrt(pixels * safeRatio);
    const idealHeight = idealWidth / safeRatio;
    return [round(idealWidth), round(idealHeight)];
}

function blankPreview(node) {
    const ratioText = String(widgetValue(node, "aspect_ratio", "1:1"));
    const [left, right] = ratioText.split(":").map(Number);
    return targetSize(left / right, widgetValue(node, "megapixels", 0.5), widgetValue(node, "multiple", 32));
}

function upstreamImageSize(node) {
    const imageInput = node.inputs?.find((input) => input.name === "image");
    const link = imageInput?.link != null ? app.graph?.links?.[imageInput.link] : null;
    const source = link ? app.graph?.getNodeById(link.origin_id) : null;
    const preview = source?.imgs?.find((item) => item?.naturalWidth && item?.naturalHeight);
    if (preview) return [preview.naturalWidth, preview.naturalHeight];
    return null;
}

function scalePreview(node) {
    const sourceSize = upstreamImageSize(node);
    if (!sourceSize) return null;
    return targetSize(
        sourceSize[0] / Math.max(1, sourceSize[1]),
        widgetValue(node, "megapixels", 0.5),
        widgetValue(node, "multiple", 32),
    );
}

function updatePreview(node) {
    const mode = widgetValue(node, "mode", MODES.blank);
    const size = mode === MODES.scale ? scalePreview(node) : blankPreview(node);
    // A missing source image has no meaningful size in scale mode. Keep the
    // space empty instead of showing a placeholder such as "-- × --".
    node.__wzqSmartSizeText = size ? `${size[0]} × ${size[1]}` : "";
    setAspectRatioEnabled(node, mode !== MODES.scale);
    node.setDirtyCanvas?.(true, false);
    app.graph?.setDirtyCanvas(true, false);
}

function setAspectRatioEnabled(node, enabled) {
    const widget = node.widgets?.find((item) => item.name === "aspect_ratio");
    if (!widget) return;
    widget.disabled = !enabled;
    widget.options ??= {};
    widget.options.disabled = !enabled;
    if (!widget.__wzqDisableGuard) {
        const originalMouse = widget.mouse;
        widget.mouse = function () {
            if (widget.disabled || widget.options?.disabled) return true;
            return originalMouse?.apply(this, arguments);
        };
        widget.__wzqDisableGuard = true;
    }
}

function drawDisabledAspectRatio(node, ctx) {
    const widget = node.widgets?.find((item) => item.name === "aspect_ratio");
    if (!widget?.disabled || widget.last_y == null) return;
    ctx.save();
    ctx.fillStyle = "rgba(25, 25, 25, 0.55)";
    ctx.fillRect(7, widget.last_y, Math.max(0, node.size[0] - 14), 22);
    ctx.restore();
}

function drawPreview(node, ctx) {
    if (!ctx || node.flags?.collapsed || !node.__wzqSmartSizeText) return;
    const imageInput = node.inputs?.find((input) => input.name === "image");
    // input.pos is the socket's vertical centre; leave room for its label,
    // then render the size on the following line.
    const y = Math.max(6, (imageInput?.pos?.[1] ?? 0) + 27);
    ctx.save();
    ctx.font = "bold 12px Arial, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillStyle = "#d9efff";
    ctx.fillText(node.__wzqSmartSizeText, 8, y);
    ctx.restore();
}

function actualSizeFromMessage(message) {
    const value = message?.wzq_image_size;
    const size = Array.isArray(value) ? value.flat(Infinity).filter(Number.isFinite) : null;
    return size?.length >= 3 ? size.slice(0, 3) : null;
}

app.registerExtension({
    name: "wzq.smart_image_size",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== NODE_TYPE) return;

        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const result = onNodeCreated?.apply(this, arguments);
            const node = this;
            for (const widget of this.widgets || []) {
                const original = widget.callback;
                widget.callback = function () {
                    const callbackResult = original?.apply(this, arguments);
                    updatePreview(node);
                    return callbackResult;
                };
            }
            requestAnimationFrame(() => updatePreview(this));
            return result;
        };

        const onConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function () {
            const result = onConfigure?.apply(this, arguments);
            requestAnimationFrame(() => updatePreview(this));
            return result;
        };

        const onConnectionsChange = nodeType.prototype.onConnectionsChange;
        nodeType.prototype.onConnectionsChange = function () {
            const result = onConnectionsChange?.apply(this, arguments);
            window.setTimeout(() => updatePreview(this), 0);
            return result;
        };

        const onExecuted = nodeType.prototype.onExecuted;
        nodeType.prototype.onExecuted = function (message) {
            const result = onExecuted?.apply(this, arguments);
            const actual = actualSizeFromMessage(message);
            if (actual) {
                this.__wzqSmartSizeText = `${actual[0]} × ${actual[1]}`;
                this.setDirtyCanvas?.(true, false);
            } else {
                updatePreview(this);
            }
            return result;
        };

        const onDrawForeground = nodeType.prototype.onDrawForeground;
        nodeType.prototype.onDrawForeground = function (ctx) {
            const result = onDrawForeground?.apply(this, arguments);
            drawDisabledAspectRatio(this, ctx);
            drawPreview(this, ctx);
            return result;
        };
    },
});
