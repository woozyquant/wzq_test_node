import { app } from "../../scripts/app.js";

// 预设列表放在 js/def_size_presets.json，便于用户自行编辑而无需改代码。
// 通过 import.meta.url 定位 JSON，保证插件目录改名后依然可用。
const PRESETS_URL = new URL("def_size_presets.json", import.meta.url).href;

// 缓存预设，避免每次右键都发请求
let _presetsCache = null;

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
        };
    }
});
