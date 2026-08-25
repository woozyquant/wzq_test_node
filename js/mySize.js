import { app } from "../../scripts/app.js";

// 预设列表放在 js/def_size_presets.json，便于用户自行编辑而无需改代码。
// 通过 import.meta.url 定位 JSON，保证插件目录改名后依然可用。
const PRESETS_URL = new URL("def_size_presets.json", import.meta.url).href;

// 缓存预设，避免每次右键都发请求
let _presetsCache = null;

const SIZE_WIDGET_NAMES = [
    "resolution",
    "width_override",
    "height_override",
    "swap_width_height",
    "upscale_factor",
    "round_to_multiple",
];
const SIZE_TITLE_SUFFIX_RE = /\s+·\s+\d+\s*×\s*\d+$/;

function getWidgetValue(node, name, fallback) {
    const widget = node.widgets?.find((item) => item.name === name);
    return widget?.value ?? fallback;
}

// Python round() rounds exact .5 values to the nearest even integer. Keep the
// live preview consistent with mySize.execute() for those edge cases too.
function pythonRound(value) {
    const lower = Math.floor(value);
    const fraction = value - lower;
    const tolerance = Number.EPSILON * Math.max(1, Math.abs(value)) * 2;
    if (Math.abs(fraction - 0.5) <= tolerance) {
        return lower % 2 === 0 ? lower : lower + 1;
    }
    return Math.round(value);
}

function calculateOutputSize(node) {
    const resolution = String(getWidgetValue(node, "resolution", "1024x1024"));
    const match = resolution.match(/(\d+)x(\d+)\s*$/i);
    let width = match ? Number(match[1]) : 1024;
    let height = match ? Number(match[2]) : 1024;

    const widthOverride = Number(getWidgetValue(node, "width_override", 0));
    const heightOverride = Number(getWidgetValue(node, "height_override", 0));
    if (widthOverride > 0) width = widthOverride;
    if (heightOverride > 0) height = heightOverride;

    const upscaleFactor = Number(getWidgetValue(node, "upscale_factor", 1));
    width = pythonRound(width * upscaleFactor);
    height = pythonRound(height * upscaleFactor);

    const roundToMultiple = getWidgetValue(node, "round_to_multiple", "8");
    if (String(roundToMultiple) !== "none") {
        const multiple = Number(roundToMultiple);
        if (Number.isFinite(multiple) && multiple > 1) {
            width = Math.ceil(width / multiple) * multiple;
            height = Math.ceil(height / multiple) * multiple;
        }
    }

    if (getWidgetValue(node, "swap_width_height", false)) {
        [width, height] = [height, width];
    }
    return [width, height];
}

function updateOutputSizeDisplay(node) {
    // 清理由旧版本写入标题的尺寸后缀，尺寸现在只显示在内容区域。
    node.title = String(node.title || "mySizexxx").replace(SIZE_TITLE_SUFFIX_RE, "");
    const [width, height] = calculateOutputSize(node);
    node.__wzqOutputSizeText = `${width}x${height}`;
    app.graph?.setDirtyCanvas(true, false);
}

function drawOutputSize(node, ctx) {
    if (!ctx || node.flags?.collapsed || !node.__wzqOutputSizeText) return;

    const x = 8;
    const y = 6;
    ctx.save();
    ctx.font = "bold 13px Arial, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillStyle = "#ffffff";
    ctx.fillText(node.__wzqOutputSizeText, x, y);
    ctx.restore();
}

function watchSizeWidgets(node) {
    for (const widget of node.widgets || []) {
        if (!SIZE_WIDGET_NAMES.includes(widget.name) || widget.__wzqSizeWatching) continue;
        const originalCallback = widget.callback;
        widget.callback = function () {
            const result = originalCallback?.apply(this, arguments);
            updateOutputSizeDisplay(node);
            return result;
        };
        widget.__wzqSizeWatching = true;
    }
}

async function loadPresets() {
    if (_presetsCache) return _presetsCache;
    // 内置兜底列表，JSON 读取失败时使用（顺序与 def_size_presets.json 一致）
    const fallback = [
        null,
        { title: "❌ 重置 (设为0)", w: 0, h: 0 },
        { title: "1:1 square (1024x1024)", w: 1024, h: 1024 },
        { title: "3:4 portrait (896x1152)", w: 896, h: 1152 },
        { title: "5:8 portrait (832x1216)", w: 832, h: 1216 },
        { title: "9:16 portrait (768x1344)", w: 768, h: 1344 },
        { title: "9:21 portrait (640x1536)", w: 640, h: 1536 },
        { title: "4:3 landscape (1152x896)", w: 1152, h: 896 },
        { title: "3:2 landscape (1216x832)", w: 1216, h: 832 },
        { title: "16:9 landscape (1344x768)", w: 1344, h: 768 },
        { title: "21:9 landscape (1536x640)", w: 1536, h: 640 },
        null,
    ];
    try {
        const resp = await fetch(PRESETS_URL);
        const data = await resp.json();
        if (data && Array.isArray(data.presets) && data.presets.length > 0) {
            _presetsCache = data.presets;
            return _presetsCache;
        }
        console.warn("[mySizexxx] def_size_presets.json 格式异常，使用内置默认列表");
        _presetsCache = fallback;
        return _presetsCache;
    } catch (e) {
        console.warn("[mySizexxx] 读取 def_size_presets.json 失败，使用内置默认列表:", e);
        _presetsCache = fallback;
        return _presetsCache;
    }
}

app.registerExtension({
    name: "wzq.mySize.robust_context",
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name !== "mySizexxx") return;

        const origGetExtraMenuOptions = nodeType.prototype.getExtraMenuOptions;

        nodeType.prototype.getExtraMenuOptions = function (_, options) {
            // 1. 先执行默认逻辑 (Properties, Bypass 等默认选项)
            if (origGetExtraMenuOptions) {
                origGetExtraMenuOptions.apply(this, arguments);
            }

            // 2. 获取鼠标在画布上的绝对坐标
            const mousePos = app.canvas.graph_mouse;
            if (!mousePos) return;

            // 3. 计算鼠标相对于节点的局部坐标
            const localY = mousePos[1] - this.pos[1];

            // 4. 判定是否点击了 width_override / height_override
            let isHit = false;
            const targetWidgets = ["width_override", "height_override"];

            if (this.widgets) {
                for (const w of this.widgets) {
                    if (targetWidgets.includes(w.name) && w.last_y !== undefined) {
                        // LiteGraph 数字输入框高度大约 20-24px
                        if (localY >= w.last_y && localY <= (w.last_y + 24)) {
                            isHit = true;
                            break;
                        }
                    }
                }
            }

            // 5. 命中则清空默认菜单，换成分辨率预设菜单
            if (isHit) {
                options.length = 0;

                options.push({
                    content: "📐 快速尺寸预设 (宽x高)",
                    disabled: true
                });
                options.push(null); // 分割线

                // 预设是异步加载的，先放一个占位项，加载完成后无法回填到已展开菜单，
                // 所以这里同步用缓存（首次右键可能为空，之后命中缓存即可秒出）。
                const presets = _presetsCache;
                if (presets && presets.length) {
                    for (const p of presets) {
                        if (p === null) {
                            options.push(null);
                            continue;
                        }
                        options.push({
                            content: p.title,
                            callback: () => {
                                const w_width = this.widgets.find(x => x.name === "width_override");
                                const w_height = this.widgets.find(x => x.name === "height_override");
                                if (w_width) { w_width.value = p.w; }
                                if (w_height) { w_height.value = p.h; }
                                updateOutputSizeDisplay(this);
                                app.graph.setDirtyCanvas(true, true);
                            }
                        });
                    }
                } else {
                    options.push({
                        content: "(加载预设中，请再次右键...)",
                        disabled: true
                    });
                }
            }
        };

        // 节点创建时预加载预设到缓存，确保第一次右键就能用
        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = async function () {
            onNodeCreated ? onNodeCreated.apply(this, []) : undefined;
            loadPresets();
            watchSizeWidgets(this);
            requestAnimationFrame(() => updateOutputSizeDisplay(this));
        };

        // Widget values are restored after node creation when loading a workflow.
        const onConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function () {
            const result = onConfigure?.apply(this, arguments);
            watchSizeWidgets(this);
            requestAnimationFrame(() => updateOutputSizeDisplay(this));
            return result;
        };

        const onDrawForeground = nodeType.prototype.onDrawForeground;
        nodeType.prototype.onDrawForeground = function (ctx) {
            const result = onDrawForeground?.apply(this, arguments);
            drawOutputSize(this, ctx);
            return result;
        };
    }
});
