import { app } from "../../scripts/app.js";
import { RgthreeLoraInfoDialog } from "/extensions/wzq_test_node/lorainfo/lorainfo.js"; 

// --- 1. CSS 样式 ---
const style = document.createElement("style");
style.textContent = `
    .my-combo-folder {
        background-color: #2a2a2a;
        border-bottom: 1px solid #3a3a3a;
        cursor: pointer;
        padding: 4px 4px 4px 18px;
        position: relative;
        color: #ddd;
        font-family: sans-serif;
        font-size: 12px;
        user-select: none;
    }
    .my-combo-folder:hover {
        background-color: #444;
        color: #fff;
    }
    .my-combo-folder-arrow {
        position: absolute;
        left: 4px;
        font-size: 10px;
        top: 6px;
        transition: transform 0.1s;
    }
    .my-combo-folder-contents {
        background-color: #222;
    }
    .my-combo-prefix {
        opacity: 0.4;
        font-size: 0.85em;
        margin-right: 5px;
    }
`;
document.head.appendChild(style);

// --- 2. 级联菜单逻辑 (左键点击) ---
function createTree(menu, items) {
    const folderMap = new Map();
    const itemsSymbol = Symbol("items");
    const splitBy = /[/\\]/; 

    for (const item of items) {
        const rawValue = item.getAttribute("data-value") || item.textContent;
        if (!rawValue) continue;
        const path = rawValue.trim().split(splitBy);
        if (path.length === 1) continue; 
        item.style.display = "none"; 
        
        let currentLevel = folderMap;
        for (let i = 0; i < path.length - 1; i++) {
            const folderName = path[i];
            if (!currentLevel.has(folderName)) currentLevel.set(folderName, new Map());
            currentLevel = currentLevel.get(folderName);
        }
        if (!currentLevel.has(itemsSymbol)) currentLevel.set(itemsSymbol, []);
        currentLevel.get(itemsSymbol).push({
            el: item, name: path[path.length - 1], fullPath: path.slice(0, -1).join("/") + "/"
        });
    }

    const insertFolderStructure = (parentElement, map, level = 0) => {
        const sortedKeys = Array.from(map.keys()).filter(key => typeof key === 'string').sort((a, b) => a.localeCompare(b));
        for (const key of sortedKeys) {
            const folderDiv = document.createElement("div");
            folderDiv.className = "my-combo-folder";
            folderDiv.innerHTML = `<span class="my-combo-folder-arrow">▶</span> ${key}`;
            folderDiv.style.paddingLeft = `${level * 15 + 18}px`; 
            parentElement.appendChild(folderDiv);
            const contentDiv = document.createElement("div");
            contentDiv.className = "my-combo-folder-contents";
            contentDiv.style.display = "none"; 
            parentElement.appendChild(contentDiv);
            const content = map.get(key);
            const files = content.get(itemsSymbol) || [];
            files.sort((a,b) => a.name.localeCompare(b.name));
            for (const fileObj of files) {
                const originalItem = fileObj.el;
                const displayItem = document.createElement("div");
                displayItem.className = "litemenu-entry"; 
                displayItem.style.paddingLeft = `${(level + 1) * 15 + 18}px`;
                displayItem.style.cursor = "pointer";
                displayItem.innerHTML = `<span class="my-combo-prefix">${fileObj.fullPath}</span>${fileObj.name}`;
                displayItem.addEventListener("click", () => {
                     originalItem.click();
                     const menuContainer = originalItem.closest(".litecontextmenu");
                     if(menuContainer) menuContainer.remove();
                });
                contentDiv.appendChild(displayItem);
            }
            insertFolderStructure(contentDiv, content, level + 1);
            const toggleFolder = (e) => {
                e.preventDefault(); e.stopPropagation();
                const arrow = folderDiv.querySelector(".my-combo-folder-arrow");
                if (contentDiv.style.display === "none") {
                    contentDiv.style.display = "block"; arrow.innerHTML = "▼";
                } else {
                    contentDiv.style.display = "none"; arrow.innerHTML = "▶";
                }
            };
            folderDiv.addEventListener("mousedown", (e) => { if (e.button === 0) toggleFolder(e); });
            folderDiv.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); });
        }
    };
    const filterInput = menu.querySelector(".comfy-context-menu-filter");
    const treeContainer = document.createElement("div");
    insertFolderStructure(treeContainer, folderMap);
    if (filterInput && filterInput.nextSibling) menu.insertBefore(treeContainer, filterInput.nextSibling);
    else menu.appendChild(treeContainer);
    fixPosition(menu);
}

function fixPosition(menu) {
    const mouseX = app.canvas.last_mouse[0];
    const mouseY = app.canvas.last_mouse[1];
    const bodyRect = document.body.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    let newTop = mouseY - 10; let newLeft = mouseX - 10;
    if (newTop + menuRect.height > bodyRect.height) newTop = bodyRect.height - menuRect.height - 10;
    if (newTop < 0) newTop = 0;
    if (newLeft + menuRect.width > bodyRect.width) newLeft = bodyRect.width - menuRect.width - 10;
    menu.style.top = `${newTop}px`; menu.style.left = `${newLeft}px`;
}

// --- 3. 辅助功能：显示信息 ---
function showLoraInfo1(loraName) {
    if (!loraName) { alert("No LoRA selected!"); return; }
    alert(`Current LoRA:\n\n${loraName}\n\n(Custom Menu Works!)`);
}

async function showLoraInfo(loraName) {
    if (!loraName) {
        alert("No LoRA selected!");
        return;
    }

    try {
        // 1. 动态导入 rgthree 的 dialog_info.js
        //const lorainfoModule = await import("lorainfo/lorainfo.js");
        
        // 2. 获取导出的类
        //const RgthreeLoraInfoDialog = lorainfoModule.MyRgthreeLoraInfoDialog;

        // 3. 实例化对话框
        // rgthree 的构造函数接受文件名作为参数：new RgthreeLoraInfoDialog(file)
        const infoDialog = new RgthreeLoraInfoDialog(loraName).show();

    } catch (error) {
        console.error("Failed to load rgthree dialog:", error);
        
        // 降级处理：如果用户没安装 rgthree 或者路径不对，使用原生 alert
        alert(
            `Selected LoRA: ${loraName}\n\n` +
            `(Could not load rgthree-comfy info dialog. Make sure rgthree-comfy is installed.)\n` +
            `Error: ${error.message}`
        );
    }
}


// --- 4. 注册扩展 (包含核心拦截逻辑) ---
app.registerExtension({
    name: "comfy.myTestNode.LoraLoader",
    init() {
        //console.log("[MyCustomNodes] Loaded!");

        // ============================================================
        // 核心逻辑：拦截 LiteGraph 的菜单创建 (彻底清空默认右键菜单)
        // ============================================================
        const originalContextMenu = LiteGraph.ContextMenu;
        
        LiteGraph.ContextMenu = function(values, options) {
            // 1. 获取上下文：当前鼠标下的节点和组件
            const canvas = app.canvas;
            const node = canvas.graph.getNodeOnPos(canvas.graph_mouse[0], canvas.graph_mouse[1]);
            const widget = canvas.getWidgetAtCursor();

            // 2. 判断条件：必须是我们的节点，且必须是 lora_name 组件
            if (node && node.comfyClass === "myLoraLoaderModelOnlyxxx") {        
                if (widget && widget.name === "lora_name") {
                    
                // 左键点击下拉框时，values 是 ["path/file.safetensors", ...] (字符串数组)
                const isDropdownList = values.length > 0 && typeof values[0] === 'string';
                if (isDropdownList) {
                    return new originalContextMenu(values, options);
                }
                    
                    // 3. 直接抛弃传入的 values (包含系统默认项)，使用我们定义的
                    const myCustomValues = [
                        {
                            content: "👉 Show Info",
                            callback: () => {
                                showLoraInfo(widget.value);
                            }
                        }
                    ];
                    
                    // 调用原始构造函数，但传入我们的数据
                    return new originalContextMenu(myCustomValues, options);
                }
            }

            // 如果不是我们的组件，保持原样，不做任何修改
            return new originalContextMenu(values, options);
        };
        
        // 保持原型链完整，防止破坏 LiteGraph 其他功能
        LiteGraph.ContextMenu.prototype = originalContextMenu.prototype;


        // ============================================================
        // 级联菜单监听 (左键点击下拉框)
        // ============================================================
        const mutationObserver = new MutationObserver((mutations) => {
            const node = app.canvas.current_node;
            if (!node || node.comfyClass !== "myLoraLoaderModelOnlyxxx") return;

            for (const mutation of mutations) {
                for (const added of mutation.addedNodes) {
                    if (added.classList?.contains("litecontextmenu")) {
                        const overWidget = app.canvas.getWidgetAtCursor();
                        if (overWidget?.name === "lora_name") {
                            const items = Array.from(added.querySelectorAll(".litemenu-entry"));
                            // 简单的判断：如果菜单项里有斜杠，说明是文件列表，应用级联样式
                            // 如果菜单项是 "lora" (我们自定义的右键菜单)，则不处理
                            const isFileList = items.some(i => (i.textContent || "").match(/[/\\]/));
                            
                            if (isFileList) {
                                requestAnimationFrame(() => {
                                    if (added.dataset.processed) return;
                                    added.dataset.processed = "true";
                                    createTree(added, items);
                                });
                            }
                        }
                    }
                }
            }
        });
        mutationObserver.observe(document.body, { childList: true, subtree: false });
    }
});