import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

// 类名是 WZQCanvasExtend，但 __init__.py 里的注册键是 myWZQCanvasExtend（历史遗留，
// 已保存的工作流依赖它，不能改）。nodeData.name 取的是注册键，这里两个都兼容，
// 以免将来注册键被修正时前端失效。
const NODE_TYPES = new Set(["WZQCanvasExtend", "myWZQCanvasExtend"]);
const HANDLES = ["tl", "t", "tr", "l", "r", "bl", "b", "br"];
const EDITOR_SIZE = [1160, 740];
const DEFAULT_NODE_SIZE = [1180, 820];

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

class CanvasExtendEditor {
    constructor(node) {
        this.node = node;
        this.disposers = [];
        this.layoutTimers = new Set();
        this.destroyed = false;
        this.state = {
            image: null,
            imageWidth: 0,
            imageHeight: 0,
            source: null,
            left: 0,
            right: 0,
            top: 0,
            bottom: 0,
            fillColor: "#ffffff",
            scale: 1,
            imageX: 0,
            imageY: 0,
            screenWidth: 1,
            screenHeight: 1,
            ratio: "free",
            ratioLocked: false,
            shapeLocked: false,
            snap: true,
            snapDistance: 15,
            dark: true,
            tool: "select",
            hovered: false,
            spaceDown: false,
            drag: null,
            fitted: false,
        };

        this.readWidgets();
        this.createPanel();
        this.bindEvents();
        this.resizeObserver = new ResizeObserver(() => this.resize());
        this.resizeObserver.observe(this.stage);
        this.scheduleLayoutSync();
        requestAnimationFrame(() => this.loadInputImage());
        this.pollTimer = window.setInterval(() => this.checkImageSource(), 750);
    }

    widget(name) {
        return this.node.widgets?.find((widget) => widget.name === name);
    }

    readWidgets() {
        const dataWidget = this.widget("extend_data");
        try {
            const data = JSON.parse(dataWidget?.value || "{}");
            for (const key of ["left", "right", "top", "bottom"]) {
                const value = Number(data[key]);
                this.state[key] = Number.isFinite(value) ? Math.round(value) : 0;
            }
        } catch (_) {
            // Keep the neutral crop when an older workflow contains invalid data.
        }
        const fill = this.widget("fill_color")?.value;
        if (typeof fill === "string" && fill) this.state.fillColor = fill;
    }

    syncFromWidgets() {
        this.readWidgets();
        if (this.fillSelect) this.fillSelect.value = this.state.fillColor;
        this.updateUI();
        this.render();
    }

    createPanel() {
        const root = document.createElement("div");
        root.className = "wzq-ce-root";
        root.innerHTML = `
            <style>
                .wzq-ce-root{width:100%;height:720px;box-sizing:border-box;display:flex;flex-direction:column;overflow:hidden;border:1px solid #35394d;border-radius:7px;background:#171923;color:#dfe2ed;font:13px Inter,system-ui,sans-serif}
                .wzq-ce-toolbar{min-height:49px;display:flex;align-items:center;overflow-x:auto;overflow-y:hidden;background:#242735;border-bottom:1px solid #35394d;padding:0 8px;box-sizing:border-box;scrollbar-width:thin}
                .wzq-ce-group{height:34px;display:flex;align-items:center;gap:5px;padding:0 8px;border-right:1px solid #3a3e50;flex:0 0 auto}
                .wzq-ce-group:last-child{border-right:0}
                .wzq-ce-btn,.wzq-ce-select,.wzq-ce-input{height:30px;box-sizing:border-box;border:1px solid #41465d;border-radius:5px;background:#2c3041;color:#e6e8f1;font:12px inherit}
                .wzq-ce-btn{min-width:30px;padding:0 9px;cursor:pointer}.wzq-ce-btn:hover{border-color:#777df0}.wzq-ce-btn.active{background:#5e63dc;border-color:#8b8ff5;color:#fff}.wzq-ce-btn:disabled{opacity:.4;cursor:default}
                .wzq-ce-select{padding:0 5px}.wzq-ce-input{width:62px;padding:0 5px;text-align:center}.wzq-ce-small{width:48px}
                .wzq-ce-check{display:flex;align-items:center;gap:4px;white-space:nowrap;color:#b8bccb}.wzq-ce-check input{accent-color:#686ee8}
                .wzq-ce-stage{position:relative;flex:1;min-height:0;overflow:hidden;background:#0b0d12;touch-action:none}
                .wzq-ce-stage canvas{position:absolute;inset:0;width:100%;height:100%}.wzq-ce-overlay{touch-action:none;pointer-events:auto;user-select:none}
                .wzq-ce-status{height:34px;flex:0 0 34px;display:flex;align-items:center;justify-content:space-between;padding:0 12px;box-sizing:border-box;background:#242735;border-top:1px solid #35394d;color:#aeb2c2;font-size:12px}
                .wzq-ce-status strong{color:#f0f1f6;font-weight:600}.wzq-ce-help{color:#858a9e;white-space:nowrap}
                .wzq-ce-root.light{background:#f6f7fb;color:#242735;border-color:#bfc3d1}.wzq-ce-root.light .wzq-ce-toolbar,.wzq-ce-root.light .wzq-ce-status{background:#e7e9f1;border-color:#c5c9d6}.wzq-ce-root.light .wzq-ce-group{border-color:#c9ccd7}.wzq-ce-root.light .wzq-ce-btn,.wzq-ce-root.light .wzq-ce-select,.wzq-ce-root.light .wzq-ce-input{background:#fff;color:#292c38;border-color:#b9bdcc}
            </style>
            <div class="wzq-ce-toolbar">
                <div class="wzq-ce-group"><button class="wzq-ce-btn" data-action="theme" title="切换明暗主题">◐</button></div>
                <div class="wzq-ce-group"><button class="wzq-ce-btn active" data-action="select">选择</button><button class="wzq-ce-btn" data-action="pan" disabled>平移</button></div>
                <div class="wzq-ce-group">
                    <select class="wzq-ce-select" data-field="ratio" title="裁剪框比例">
                        <option value="free">自由比例</option><option>1:1</option><option>5:4</option><option>4:5</option>
                        <option>2:3</option><option>3:2</option><option>3:4</option><option>4:3</option>
                        <option>9:16</option><option>16:9</option><option>21:9</option><option>9:21</option>
                    </select>
                    <button class="wzq-ce-btn" data-action="ratio-lock" title="锁定当前比例">锁比</button>
                    <input class="wzq-ce-input" data-field="width" type="number" min="1" placeholder="宽">
                    <span>×</span><input class="wzq-ce-input" data-field="height" type="number" min="1" placeholder="高">
                    <button class="wzq-ce-btn" data-action="reset" title="还原到原图边界 (R)">还原</button>
                </div>
                <div class="wzq-ce-group">
                    <select class="wzq-ce-select" data-field="align"><option value="center">居中</option><option value="left">左对齐</option><option value="right">右对齐</option><option value="top">上对齐</option><option value="bottom">下对齐</option></select>
                    <button class="wzq-ce-btn" data-action="align">应用</button>
                </div>
                <div class="wzq-ce-group">
                    <select class="wzq-ce-select" data-field="fill"><option value="#ffffff">白色填充</option><option value="#000000">黑色填充</option><option value="#ff0000">红色填充</option><option value="#00ff00">绿色填充</option><option value="#0000ff">蓝色填充</option><option value="transparent">透明/黑色</option></select>
                </div>
                <div class="wzq-ce-group"><label class="wzq-ce-check"><input data-field="snap" type="checkbox" checked>吸附</label><input class="wzq-ce-input wzq-ce-small" data-field="snap-distance" type="number" min="1" max="100" value="15"></div>
                <div class="wzq-ce-group"><button class="wzq-ce-btn" data-action="shape-lock" title="拖拽时保持当前框比例">等比</button><button class="wzq-ce-btn" data-action="fit" title="适合窗口">适屏</button></div>
            </div>
            <div class="wzq-ce-stage"><canvas class="wzq-ce-main"></canvas><canvas class="wzq-ce-overlay"></canvas></div>
            <div class="wzq-ce-status"><div>画布 <strong data-status="canvas">--</strong>　原图 <strong data-status="image">--</strong></div><div class="wzq-ce-help">图片内滚轮缩放图片 · 图片外滚轮缩放工作流 · 空格拖动画面</div></div>`;

        this.root = root;
        this.toolbar = root.querySelector(".wzq-ce-toolbar");
        this.stage = root.querySelector(".wzq-ce-stage");
        this.mainCanvas = root.querySelector(".wzq-ce-main");
        this.overlayCanvas = root.querySelector(".wzq-ce-overlay");
        this.ctx = this.mainCanvas.getContext("2d");
        this.overlayCtx = this.overlayCanvas.getContext("2d");
        this.widthInput = root.querySelector('[data-field="width"]');
        this.heightInput = root.querySelector('[data-field="height"]');
        this.fillSelect = root.querySelector('[data-field="fill"]');
        this.fillSelect.value = this.state.fillColor;

        const widget = this.node.addDOMWidget("wzq_canvas_extend_editor", "div", root, {
            serialize: false,
            getMinHeight: () => EDITOR_SIZE[1],
            getMaxHeight: () => EDITOR_SIZE[1],
            getHeight: () => EDITOR_SIZE[1],
        });
        widget.computeSize = () => [...EDITOR_SIZE];
    }

    listen(target, type, handler, options) {
        target.addEventListener(type, handler, options);
        this.disposers.push(() => target.removeEventListener(type, handler, options));
    }

    bindEvents() {
        const button = (action) => this.root.querySelector(`[data-action="${action}"]`);
        const field = (name) => this.root.querySelector(`[data-field="${name}"]`);

        this.listen(button("theme"), "click", () => {
            this.state.dark = !this.state.dark;
            this.root.classList.toggle("light", !this.state.dark);
            this.render();
        });
        this.listen(button("select"), "click", () => this.setTool("select"));
        this.listen(button("pan"), "click", () => this.setTool("pan"));
        this.listen(button("reset"), "click", () => this.reset());
        this.listen(button("fit"), "click", () => this.fitView());
        this.listen(button("align"), "click", () => this.align(field("align").value));
        this.listen(button("ratio-lock"), "click", () => {
            this.state.ratioLocked = !this.state.ratioLocked;
            button("ratio-lock").classList.toggle("active", this.state.ratioLocked);
        });
        this.listen(button("shape-lock"), "click", () => {
            this.state.shapeLocked = !this.state.shapeLocked;
            button("shape-lock").classList.toggle("active", this.state.shapeLocked);
        });
        this.listen(field("ratio"), "change", (event) => {
            this.state.ratio = event.target.value;
            this.state.ratioLocked = this.state.ratio !== "free";
            button("ratio-lock").classList.toggle("active", this.state.ratioLocked);
            if (this.state.image && this.state.ratio !== "free") this.applyRatio();
        });
        this.listen(this.widthInput, "change", () => this.applyNumericSize("width"));
        this.listen(this.heightInput, "change", () => this.applyNumericSize("height"));
        this.listen(this.fillSelect, "change", (event) => {
            this.state.fillColor = event.target.value;
            this.setWidget("fill_color", this.state.fillColor);
            this.render();
        });
        this.listen(field("snap"), "change", (event) => (this.state.snap = event.target.checked));
        this.listen(field("snap-distance"), "change", (event) => {
            this.state.snapDistance = clamp(Number(event.target.value) || 15, 1, 100);
        });

        this.listen(this.root, "mouseenter", () => (this.state.hovered = true));
        this.listen(this.root, "mouseleave", () => (this.state.hovered = false));
        this.listen(this.overlayCanvas, "pointerdown", (event) => this.pointerDown(event));
        this.listen(this.overlayCanvas, "pointermove", (event) => this.pointerMove(event));
        this.listen(this.overlayCanvas, "pointerup", (event) => this.pointerUp(event));
        this.listen(this.overlayCanvas, "pointercancel", (event) => this.pointerUp(event));
        this.listen(this.overlayCanvas, "lostpointercapture", (event) => this.pointerUp(event));
        this.listen(this.overlayCanvas, "wheel", (event) => this.wheel(event), { passive: false });
        this.listen(document, "keydown", (event) => this.keyDown(event));
        this.listen(document, "keyup", (event) => this.keyUp(event));
    }

    destroy() {
        this.destroyed = true;
        window.clearInterval(this.pollTimer);
        this.resizeObserver?.disconnect();
        for (const timer of this.layoutTimers) window.clearTimeout(timer);
        this.layoutTimers.clear();
        for (const dispose of this.disposers.splice(0)) dispose();
    }

    scheduleLayoutSync() {
        if (this.destroyed || this.layoutTimers.size) return;
        for (const delay of [0, 32, 100, 250, 600]) {
            const timer = window.setTimeout(() => {
                this.layoutTimers.delete(timer);
                if (this.destroyed) return;
                const synced = this.resize({ force: true });
                if (synced) {
                    this.node.setDirtyCanvas?.(true, true);
                    this.node.graph?.setDirtyCanvas?.(true, true);
                }
            }, delay);
            this.layoutTimers.add(timer);
        }
    }

    resize({ force = false } = {}) {
        // Use layout dimensions, not getBoundingClientRect(). ComfyUI scales DOM
        // widgets with a CSS transform; the latter already contains workflow zoom
        // and would put drawing coordinates and pointer coordinates in two systems.
        const width = Math.floor(this.stage.clientWidth);
        const height = Math.floor(this.stage.clientHeight);
        // Detached DOM widgets temporarily report zero size while a new node is
        // being mounted. Do not lock the editor into a fake 1x1 coordinate space.
        if (width < 32 || height < 32) return false;
        if (!force && width === this.state.screenWidth && height === this.state.screenHeight) return true;
        this.state.screenWidth = width;
        this.state.screenHeight = height;
        const dpr = Math.max(1, window.devicePixelRatio || 1);
        for (const canvas of [this.mainCanvas, this.overlayCanvas]) {
            canvas.width = Math.floor(width * dpr);
            canvas.height = Math.floor(height * dpr);
        }
        if (this.state.image) this.fitView();
        else this.render();
        return true;
    }

    rect() {
        const s = this.state;
        return { x0: -s.left, y0: -s.top, x1: s.imageWidth + s.right, y1: s.imageHeight + s.bottom };
    }

    setRect(rect, { commit = true } = {}) {
        const s = this.state;
        if (rect.x1 - rect.x0 < 1 || rect.y1 - rect.y0 < 1) return false;
        s.left = Math.round(-rect.x0);
        s.top = Math.round(-rect.y0);
        s.right = Math.round(rect.x1 - s.imageWidth);
        s.bottom = Math.round(rect.y1 - s.imageHeight);
        this.applySnap();
        if (commit) this.commit();
        return true;
    }

    applySnap() {
        const s = this.state;
        if (!s.snap) return;
        for (const key of ["left", "right", "top", "bottom"]) {
            if (Math.abs(s[key]) < s.snapDistance) s[key] = 0;
        }
    }

    commit() {
        const s = this.state;
        this.setWidget("extend_data", JSON.stringify({ left: s.left, right: s.right, top: s.top, bottom: s.bottom }));
        this.updateUI();
        this.render();
    }

    setWidget(name, value) {
        const widget = this.widget(name);
        if (!widget || widget.value === value) return;
        widget.value = value;
        if (typeof widget.callback === "function") widget.callback(value);
        this.node.graph?.setDirtyCanvas?.(true, false);
    }

    updateUI() {
        const s = this.state;
        const width = Math.max(0, s.imageWidth + s.left + s.right);
        const height = Math.max(0, s.imageHeight + s.top + s.bottom);
        if (document.activeElement !== this.widthInput) this.widthInput.value = s.image ? Math.round(width) : "";
        if (document.activeElement !== this.heightInput) this.heightInput.value = s.image ? Math.round(height) : "";
        this.root.querySelector('[data-status="canvas"]').textContent = s.image ? `${Math.round(width)} × ${Math.round(height)}` : "--";
        this.root.querySelector('[data-status="image"]').textContent = s.image ? `${s.imageWidth} × ${s.imageHeight}` : "--";
    }

    targetRatio() {
        if (this.state.ratio !== "free") {
            const [width, height] = this.state.ratio.split(":").map(Number);
            return width / height;
        }
        const rect = this.rect();
        return (rect.x1 - rect.x0) / Math.max(1, rect.y1 - rect.y0);
    }

    applyRatio() {
        const s = this.state;
        const ratio = this.targetRatio();
        let width = s.imageWidth;
        let height = width / ratio;
        if (height > s.imageHeight) {
            height = s.imageHeight;
            width = height * ratio;
        }
        this.setCenteredSize(width, height);
    }

    applyNumericSize(changed) {
        if (!this.state.image) return;
        let width = Number(this.widthInput.value);
        let height = Number(this.heightInput.value);
        if (!(width >= 1) || !(height >= 1)) return;
        if (this.state.ratioLocked) {
            const ratio = this.targetRatio();
            if (changed === "width") height = width / ratio;
            else width = height * ratio;
        }
        this.setCenteredSize(width, height);
        this.fitView();
    }

    setCenteredSize(width, height) {
        const s = this.state;
        const cx = s.imageWidth / 2;
        const cy = s.imageHeight / 2;
        this.setRect({ x0: cx - width / 2, x1: cx + width / 2, y0: cy - height / 2, y1: cy + height / 2 });
    }

    align(type) {
        if (!this.state.image) return;
        const s = this.state;
        const current = this.rect();
        const width = current.x1 - current.x0;
        const height = current.y1 - current.y0;
        let x0 = current.x0;
        let y0 = current.y0;
        if (type === "center") {
            x0 = (s.imageWidth - width) / 2;
            y0 = (s.imageHeight - height) / 2;
        } else if (type === "left") x0 = 0;
        else if (type === "right") x0 = s.imageWidth - width;
        else if (type === "top") y0 = 0;
        else if (type === "bottom") y0 = s.imageHeight - height;
        this.setRect({ x0, y0, x1: x0 + width, y1: y0 + height });
    }

    reset() {
        if (!this.state.image) return;
        this.state.left = this.state.right = this.state.top = this.state.bottom = 0;
        this.state.ratio = "free";
        this.state.ratioLocked = false;
        this.root.querySelector('[data-field="ratio"]').value = "free";
        this.root.querySelector('[data-action="ratio-lock"]').classList.remove("active");
        this.commit();
        this.fitView();
    }

    setTool(tool) {
        this.state.tool = tool;
        for (const name of ["select", "pan"]) this.root.querySelector(`[data-action="${name}"]`).classList.toggle("active", name === tool);
        this.updateCursor();
    }

    fitView(render = true) {
        const s = this.state;
        if (!s.image) return;
        const crop = this.rect();
        const x0 = Math.min(0, crop.x0);
        const y0 = Math.min(0, crop.y0);
        const x1 = Math.max(s.imageWidth, crop.x1);
        const y1 = Math.max(s.imageHeight, crop.y1);
        const availableWidth = Math.max(50, s.screenWidth - 70);
        const availableHeight = Math.max(50, s.screenHeight - 70);
        s.scale = clamp(Math.min(availableWidth / Math.max(1, x1 - x0), availableHeight / Math.max(1, y1 - y0)), 0.02, 20);
        s.imageX = s.screenWidth / 2 - ((x0 + x1) / 2) * s.scale;
        s.imageY = s.screenHeight / 2 - ((y0 + y1) / 2) * s.scale;
        s.fitted = true;
        if (render) this.render();
    }

    canvasPoint(event) {
        const rect = this.overlayCanvas.getBoundingClientRect();
        const scaleX = rect.width > 0 ? this.state.screenWidth / rect.width : 1;
        const scaleY = rect.height > 0 ? this.state.screenHeight / rect.height : 1;
        return {
            x: (event.clientX - rect.left) * scaleX,
            y: (event.clientY - rect.top) * scaleY,
        };
    }

    screenRect(rect = this.rect()) {
        const s = this.state;
        return { x0: s.imageX + rect.x0 * s.scale, y0: s.imageY + rect.y0 * s.scale, x1: s.imageX + rect.x1 * s.scale, y1: s.imageY + rect.y1 * s.scale };
    }

    handlePositions() {
        const rect = this.screenRect();
        const cx = (rect.x0 + rect.x1) / 2;
        const cy = (rect.y0 + rect.y1) / 2;
        return { tl: [rect.x0, rect.y0], t: [cx, rect.y0], tr: [rect.x1, rect.y0], l: [rect.x0, cy], r: [rect.x1, cy], bl: [rect.x0, rect.y1], b: [cx, rect.y1], br: [rect.x1, rect.y1] };
    }

    workflowScale() {
        const rect = this.overlayCanvas.getBoundingClientRect();
        return rect.width > 0 ? rect.width / Math.max(1, this.state.screenWidth) : 1;
    }

    handleHitRadius() {
        // DOM widgets are transformed together with the workflow. Keep the
        // clickable target close to 14 screen pixels even at a zoomed-out view.
        return clamp(14 / Math.max(0.05, this.workflowScale()), 14, 42);
    }

    handleDrawRadius() {
        return clamp(7 / Math.max(0.05, this.workflowScale()), 7, 21);
    }

    hitHandle(point) {
        const positions = this.handlePositions();
        const radius = this.handleHitRadius();
        for (const handle of HANDLES) {
            const [x, y] = positions[handle];
            if (Math.hypot(point.x - x, point.y - y) <= radius) return handle;
        }
        return null;
    }

    pointerDown(event) {
        if (event.button !== 0 || !this.state.image) return;
        event.preventDefault();
        const point = this.canvasPoint(event);
        const crop = this.screenRect();
        let kind = null;
        let handle = null;
        if (this.state.spaceDown || this.state.tool === "pan") kind = "pan";
        else if ((handle = this.hitHandle(point))) kind = "resize";
        else if (point.x >= crop.x0 && point.x <= crop.x1 && point.y >= crop.y0 && point.y <= crop.y1) kind = "move";
        if (!kind) return;
        this.state.drag = { kind, handle, start: point, imageX: this.state.imageX, imageY: this.state.imageY, rect: this.rect(), ratio: this.targetRatio() };
        // The DOM widget is layered above LiteGraph. Once this editor accepts a
        // gesture, do not let the workflow canvas or node wrapper steal it.
        event.stopPropagation();
        this.overlayCanvas.setPointerCapture?.(event.pointerId);
        this.updateCursor(point);
    }

    pointerMove(event) {
        if (!this.state.image) return;
        const point = this.canvasPoint(event);
        const drag = this.state.drag;
        if (!drag) {
            this.updateCursor(point);
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        const dx = (point.x - drag.start.x) / this.state.scale;
        const dy = (point.y - drag.start.y) / this.state.scale;
        if (drag.kind === "pan") {
            this.state.imageX = drag.imageX + point.x - drag.start.x;
            this.state.imageY = drag.imageY + point.y - drag.start.y;
            this.render();
            return;
        }
        let rect = { ...drag.rect };
        if (drag.kind === "move") {
            rect = { x0: rect.x0 + dx, x1: rect.x1 + dx, y0: rect.y0 + dy, y1: rect.y1 + dy };
        } else {
            const handle = drag.handle;
            if (handle.includes("l")) rect.x0 += dx;
            if (handle.includes("r")) rect.x1 += dx;
            if (handle.includes("t")) rect.y0 += dy;
            if (handle.includes("b")) rect.y1 += dy;
            if (this.state.ratioLocked || this.state.shapeLocked) rect = this.constrainRatio(rect, drag);
        }
        this.setRect(rect);
    }

    constrainRatio(rect, drag) {
        const handle = drag.handle;
        const ratio = drag.ratio;
        const original = drag.rect;
        if (handle === "l" || handle === "r") {
            const width = Math.max(1, rect.x1 - rect.x0);
            const height = width / ratio;
            const cy = (original.y0 + original.y1) / 2;
            rect.y0 = cy - height / 2;
            rect.y1 = cy + height / 2;
        } else if (handle === "t" || handle === "b") {
            const height = Math.max(1, rect.y1 - rect.y0);
            const width = height * ratio;
            const cx = (original.x0 + original.x1) / 2;
            rect.x0 = cx - width / 2;
            rect.x1 = cx + width / 2;
        } else {
            const anchorX = handle.includes("l") ? original.x1 : original.x0;
            const anchorY = handle.includes("t") ? original.y1 : original.y0;
            let width = Math.max(1, Math.abs((handle.includes("l") ? rect.x0 : rect.x1) - anchorX));
            let height = Math.max(1, Math.abs((handle.includes("t") ? rect.y0 : rect.y1) - anchorY));
            if (width / height > ratio) height = width / ratio;
            else width = height * ratio;
            if (handle.includes("l")) { rect.x0 = anchorX - width; rect.x1 = anchorX; } else { rect.x0 = anchorX; rect.x1 = anchorX + width; }
            if (handle.includes("t")) { rect.y0 = anchorY - height; rect.y1 = anchorY; } else { rect.y0 = anchorY; rect.y1 = anchorY + height; }
        }
        return rect;
    }

    pointerUp(event) {
        if (!this.state.drag) return;
        event.preventDefault();
        event.stopPropagation();
        this.state.drag = null;
        try { this.overlayCanvas.releasePointerCapture?.(event.pointerId); } catch (_) { /* already released */ }
        this.updateCursor(this.canvasPoint(event));
    }

    updateCursor(point) {
        if (!this.state.image) return (this.overlayCanvas.style.cursor = "default");
        if (this.state.drag?.kind === "pan" || this.state.spaceDown || this.state.tool === "pan") return (this.overlayCanvas.style.cursor = this.state.drag ? "grabbing" : "grab");
        const handle = point ? this.hitHandle(point) : null;
        const cursors = { tl: "nwse-resize", br: "nwse-resize", tr: "nesw-resize", bl: "nesw-resize", t: "ns-resize", b: "ns-resize", l: "ew-resize", r: "ew-resize" };
        if (handle) this.overlayCanvas.style.cursor = cursors[handle];
        else if (point) {
            const crop = this.screenRect();
            const inside = point.x >= crop.x0 && point.x <= crop.x1 && point.y >= crop.y0 && point.y <= crop.y1;
            this.overlayCanvas.style.cursor = inside ? "move" : "default";
        } else this.overlayCanvas.style.cursor = "default";
    }

    wheel(event) {
        const point = this.canvasPoint(event);
        const s = this.state;
        const imageRight = s.imageX + s.imageWidth * s.scale;
        const imageBottom = s.imageY + s.imageHeight * s.scale;
        const isOverImage = s.image && point.x >= s.imageX && point.x <= imageRight
            && point.y >= s.imageY && point.y <= imageBottom;

        // DOM widgets sit above LiteGraph's canvas, so wheel events outside the
        // image must be explicitly forwarded to ComfyUI's native handler.
        if (!isOverImage) {
            if (typeof app.canvas?.processMouseWheel === "function") {
                event.preventDefault();
                event.stopPropagation();
                app.canvas.processMouseWheel(event);
            }
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        const worldX = (point.x - s.imageX) / s.scale;
        const worldY = (point.y - s.imageY) / s.scale;
        s.scale = clamp(s.scale * (event.deltaY > 0 ? 0.9 : 1.1), 0.02, 20);
        s.imageX = point.x - worldX * s.scale;
        s.imageY = point.y - worldY * s.scale;
        this.render();
    }

    keyDown(event) {
        if (!this.state.hovered || !this.state.image) return;
        const tag = document.activeElement?.tagName;
        if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
        if (event.code === "Space") {
            event.preventDefault();
            this.state.spaceDown = true;
            this.updateCursor();
        } else if (!event.ctrlKey && !event.metaKey && event.key.toLowerCase() === "r") this.reset();
        else if (!event.ctrlKey && !event.metaKey && event.key.toLowerCase() === "v") this.setTool("select");
    }

    keyUp(event) {
        if (event.code !== "Space") return;
        this.state.spaceDown = false;
        this.updateCursor();
    }

    render() {
        const s = this.state;
        const dpr = Math.max(1, window.devicePixelRatio || 1);
        const setup = (ctx) => { ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, s.screenWidth, s.screenHeight); };
        setup(this.ctx);
        setup(this.overlayCtx);
        const ctx = this.ctx;
        ctx.fillStyle = s.dark ? "#0b0d12" : "#e7e9f0";
        ctx.fillRect(0, 0, s.screenWidth, s.screenHeight);
        if (!s.image) {
            ctx.fillStyle = s.dark ? "#777c91" : "#656a7a";
            ctx.font = "15px Inter,system-ui,sans-serif";
            ctx.textAlign = "center";
            ctx.fillText("等待上游图像输入…", s.screenWidth / 2, s.screenHeight / 2);
            this.updateUI();
            return;
        }

        const crop = this.screenRect();
        const cropWidth = crop.x1 - crop.x0;
        const cropHeight = crop.y1 - crop.y0;
        if (s.fillColor === "transparent") this.checkerboard(ctx, crop.x0, crop.y0, cropWidth, cropHeight);
        else {
            ctx.fillStyle = s.fillColor;
            ctx.fillRect(crop.x0, crop.y0, cropWidth, cropHeight);
        }
        ctx.drawImage(s.image, s.imageX, s.imageY, s.imageWidth * s.scale, s.imageHeight * s.scale);

        // Dim pixels outside the selected output rectangle while keeping them visible.
        ctx.save();
        ctx.fillStyle = s.dark ? "rgba(0,0,0,.58)" : "rgba(220,223,233,.62)";
        ctx.beginPath();
        ctx.rect(0, 0, s.screenWidth, s.screenHeight);
        ctx.rect(crop.x0, crop.y0, cropWidth, cropHeight);
        ctx.fill("evenodd");
        ctx.restore();

        ctx.save();
        ctx.beginPath();
        ctx.rect(crop.x0, crop.y0, cropWidth, cropHeight);
        ctx.clip();
        ctx.strokeStyle = "rgba(255,255,255,.32)";
        ctx.lineWidth = 1;
        for (let i = 1; i < 3; i++) {
            ctx.beginPath(); ctx.moveTo(crop.x0 + cropWidth * i / 3, crop.y0); ctx.lineTo(crop.x0 + cropWidth * i / 3, crop.y1); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(crop.x0, crop.y0 + cropHeight * i / 3); ctx.lineTo(crop.x1, crop.y0 + cropHeight * i / 3); ctx.stroke();
        }
        ctx.restore();

        const overlay = this.overlayCtx;
        overlay.save();
        overlay.strokeStyle = "#ff4d5f";
        overlay.lineWidth = 1.5;
        overlay.setLineDash([6, 5]);
        overlay.strokeRect(crop.x0, crop.y0, cropWidth, cropHeight);
        overlay.setLineDash([]);
        const handleRadius = this.handleDrawRadius();
        for (const [x, y] of Object.values(this.handlePositions())) {
            overlay.fillStyle = "#fff";
            overlay.strokeStyle = "#ff4d5f";
            overlay.lineWidth = 2;
            overlay.fillRect(x - handleRadius, y - handleRadius, handleRadius * 2, handleRadius * 2);
            overlay.strokeRect(x - handleRadius, y - handleRadius, handleRadius * 2, handleRadius * 2);
        }
        overlay.restore();
        this.updateUI();
    }

    checkerboard(ctx, x, y, width, height) {
        ctx.save();
        ctx.beginPath(); ctx.rect(x, y, width, height); ctx.clip();
        const size = 12;
        for (let row = Math.floor(y / size); row <= Math.ceil((y + height) / size); row++) {
            for (let col = Math.floor(x / size); col <= Math.ceil((x + width) / size); col++) {
                ctx.fillStyle = (row + col) % 2 ? "#d4d4d4" : "#fff";
                ctx.fillRect(col * size, row * size, size, size);
            }
        }
        ctx.restore();
    }

    imageInfoUrl(info) {
        if (!info?.filename) return null;
        const query = new URLSearchParams({ filename: info.filename, subfolder: info.subfolder || "", type: info.type || "output" });
        return api.apiURL(`/view?${query.toString()}`);
    }

    findSource(node, visited = new Set()) {
        if (!node || visited.has(node.id)) return null;
        visited.add(node.id);
        const liveImage = node.imgs?.find((image) => image?.src);
        if (liveImage?.src) return liveImage.src;
        const infoUrl = this.imageInfoUrl(node.images?.[0]);
        if (infoUrl) return infoUrl;
        const imageWidget = node.widgets?.find((widget) => widget.name === "image" && typeof widget.value === "string");
        if (imageWidget?.value) {
            const match = imageWidget.value.match(/^(.*?)(?:\s+\[(input|output|temp)\])?$/);
            if (match?.[1]) return this.imageInfoUrl({ filename: match[1], type: match[2] || "input" });
        }
        for (const input of node.inputs || []) {
            if (input.link == null) continue;
            const link = app.graph?.links?.[input.link];
            const source = link ? app.graph.getNodeById(link.origin_id) : null;
            const found = this.findSource(source, visited);
            if (found) return found;
        }
        return null;
    }

    upstreamNode() {
        const input = this.node.inputs?.find((entry) => entry.name === "image");
        if (!input || input.link == null) return null;
        const link = app.graph?.links?.[input.link];
        return link ? app.graph.getNodeById(link.origin_id) : null;
    }

    checkImageSource() {
        const source = this.findSource(this.upstreamNode());
        if (source && source !== this.state.source) this.loadImage(source);
    }

    loadInputImage(force = false) {
        const source = this.findSource(this.upstreamNode());
        if (!source) {
            if (!this.upstreamNode()) {
                this.state.image = null;
                this.state.source = null;
                this.render();
            }
            return;
        }
        this.loadImage(source, force);
    }

    loadImage(source, force = false) {
        if (!force && source === this.state.source) return;
        this.state.source = source;
        const image = new Image();
        image.crossOrigin = "anonymous";
        image.onload = () => {
            if (this.state.source !== source) return;
            this.state.image = image;
            this.state.imageWidth = image.naturalWidth || image.width;
            this.state.imageHeight = image.naturalHeight || image.height;
            this.root.querySelector('[data-action="pan"]').disabled = false;
            this.updateUI();
            this.fitView();
        };
        image.onerror = () => {
            if (this.state.source === source) {
                this.state.image = null;
                this.render();
            }
        };
        image.src = source;
    }
}

app.registerExtension({
    name: "wzq.CanvasExtendEditor",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (!NODE_TYPES.has(nodeData.name)) return;

        const originalCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const result = originalCreated?.apply(this, arguments);
            this._wzqCanvasExtendEditor = new CanvasExtendEditor(this);
            this.setSize([...DEFAULT_NODE_SIZE]);
            this._wzqCanvasExtendEditor.scheduleLayoutSync();
            return result;
        };

        const originalAdded = nodeType.prototype.onAdded;
        nodeType.prototype.onAdded = function () {
            const result = originalAdded?.apply(this, arguments);
            this._wzqCanvasExtendEditor?.scheduleLayoutSync();
            return result;
        };

        const originalResize = nodeType.prototype.onResize;
        nodeType.prototype.onResize = function () {
            const result = originalResize?.apply(this, arguments);
            this._wzqCanvasExtendEditor?.scheduleLayoutSync();
            return result;
        };

        const originalConfigured = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function () {
            const result = originalConfigured?.apply(this, arguments);
            window.setTimeout(() => {
                this._wzqCanvasExtendEditor?.syncFromWidgets();
                this.setSize([
                    Math.max(this.size?.[0] || 0, DEFAULT_NODE_SIZE[0]),
                    Math.max(this.size?.[1] || 0, DEFAULT_NODE_SIZE[1]),
                ]);
                this._wzqCanvasExtendEditor?.scheduleLayoutSync();
            }, 0);
            return result;
        };

        const originalConnections = nodeType.prototype.onConnectionsChange;
        nodeType.prototype.onConnectionsChange = function (type) {
            const result = originalConnections?.apply(this, arguments);
            if (type === 1) window.setTimeout(() => this._wzqCanvasExtendEditor?.loadInputImage(true), 100);
            return result;
        };

        const originalExecuted = nodeType.prototype.onExecuted;
        nodeType.prototype.onExecuted = function () {
            const result = originalExecuted?.apply(this, arguments);
            window.setTimeout(() => this._wzqCanvasExtendEditor?.loadInputImage(true), 100);
            return result;
        };

        const originalRemoved = nodeType.prototype.onRemoved;
        nodeType.prototype.onRemoved = function () {
            this._wzqCanvasExtendEditor?.destroy();
            return originalRemoved?.apply(this, arguments);
        };
    },
});
