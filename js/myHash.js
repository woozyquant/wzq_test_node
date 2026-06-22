import { app } from "../../scripts/app.js";

// 定义预设分辨率列表
const PRESET_RESOLUTIONS = [
    null,
    { title: "❌ 重置 (设为0)", w: 0, h: 0 },
    { title: "1:1 - SDXL (1024x1024)", w: 1024, h: 1024 },
    { title: "2:3 - SDXL (832x1216)", w: 832, h: 1216 },
    { title: "3:2 - SDXL (1216x832)", w: 1216, h: 832 },
    { title: "1:2 - SDXL (832x1536)", w: 832, h: 1536 },
    { title: "1:1 - Qwen (1328x1328)", w: 1328, h: 1328 },
    { title: "9:16 - Mobile (1080x1920)", w: 1080, h: 1920 },
    null,
];

app.registerExtension({
    name: "wzq.myEmptyLatentQwen.robust_context",
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name === "myEmptyLatentQwenxxx") {
            
            // 获取原本的菜单逻辑
            const origGetExtraMenuOptions = nodeType.prototype.getExtraMenuOptions;

            // 重写菜单逻辑
            nodeType.prototype.getExtraMenuOptions = function(_, options) {
                
                // 1. 先执行默认逻辑 (生成 Properties, Bypass 等默认选项)
                if (origGetExtraMenuOptions) {
                    origGetExtraMenuOptions.apply(this, arguments);
                }

                // 2. 获取当前鼠标在画布上的绝对坐标 (World Coordinate)
                // app.canvas.graph_mouse 是 LiteGraph 实时记录的鼠标位置
                const mousePos = app.canvas.graph_mouse;
                if (!mousePos) return;

                // 3. 计算鼠标相对于节点的局部坐标 (Local Coordinate)
                // 节点自身的位置在 this.pos
                const localY = mousePos[1] - this.pos[1];
                
                // 4. 判定是否点击了特定的 widget
                let isHit = false;
                const targetWidgets = ["width_override", "height_override"];

                if (this.widgets) {
                    for (const w of this.widgets) {
                        if (targetWidgets.includes(w.name) && w.last_y !== undefined) {
                            // w.last_y 是控件相对于节点顶部的 Y 轴偏移量
                            // LiteGraph 的数字输入框高度大约是 20-24px
                            // 我们判断：鼠标的局部Y坐标 是否落在 [控件Y, 控件Y + 24] 之间
                            if (localY >= w.last_y && localY <= (w.last_y + 24)) {
                                isHit = true;
                                break;
                            }
                        }
                    }
                }

                // 5. 如果命中了，清空默认菜单，换成我们的菜单
                if (isHit) {
                    // 暴力清空数组，移除所有默认选项
                    options.length = 0;

                    // 添加标题
                    options.push({
                        content: "📐 快速分辨率预设",
                        disabled: true
                    });
                    options.push(null); // 分割线

                    // 填充预设
                    for (const p of PRESET_RESOLUTIONS) {
                        if (p === null) {
                            options.push(null);
                            continue;
                        }
                        options.push({
                            content: p.title,
                            callback: () => {
                                // 找到并更新两个控件
                                const w_width = this.widgets.find(x => x.name === "width_override");
                                const w_height = this.widgets.find(x => x.name === "height_override");

                                if (w_width) { w_width.value = p.w; }
                                if (w_height) { w_height.value = p.h; }

                                // 强制刷新画布，让界面数字变动可见
                                app.graph.setDirtyCanvas(true, true);
                            }
                        });
                    }
                }
            }
        }
    }
});