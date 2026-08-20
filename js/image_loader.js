import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const NODE_NAME = "WZQImageLoader";

const widget = (node, name) => node.widgets?.find((item) => item.name === name);
const namesOf = (node) => String(widget(node, "image_list")?.value || "")
    .replace(/\r/g, "")
    .split("\n")
    .map((name) => name.trim())
    .filter(Boolean);

function setWidget(node, name, value) {
    const item = widget(node, name);
    if (!item) return;
    item.value = value;
    item.callback?.(value);
    node.graph?.setDirtyCanvas(true, true);
}

function setNames(node, names) {
    setWidget(node, "image_list", [...new Set(names.filter(Boolean))].join("\n"));
}

function annotated(name, source) {
    return source === "input" ? name : `${name} [${source}]`;
}

function splitAnnotated(value) {
    for (const source of ["input", "output", "temp"]) {
        const suffix = ` [${source}]`;
        if (value.endsWith(suffix)) return { name: value.slice(0, -suffix.length), source };
    }
    return { name: value, source: "input" };
}

function thumbUrl(name) {
    return api.apiURL(`/wzq/image-loader/thumb?name=${encodeURIComponent(name)}`);
}

function button(label, title = label) {
    const element = document.createElement("button");
    element.type = "button";
    element.textContent = label;
    element.title = title;
    element.style.cssText = "width:100%;padding:6px 3px;border:1px solid var(--border-color);border-radius:5px;background:var(--comfy-input-bg);color:var(--input-text);font-size:12px;line-height:1.25;cursor:pointer;white-space:nowrap;";
    element.onmouseenter = () => { element.style.filter = "brightness(1.2)"; };
    element.onmouseleave = () => { element.style.filter = ""; };
    return element;
}

function notify(message) {
    if (app.extensionManager?.toast?.add) {
        app.extensionManager.toast.add({ severity: "error", summary: "WZQ 图像加载器", detail: message, life: 5000 });
    } else {
        window.alert(message);
    }
}

async function uploadImages(files) {
    const uploaded = [];
    for (const file of files) {
        if (!file || (file.type && !file.type.startsWith("image/"))) continue;
        const body = new FormData();
        body.append("image", file, file.name);
        body.append("type", "input");
        const response = await api.fetchApi("/upload/image", { method: "POST", body });
        if (!response.ok) throw new Error(await response.text());
        const data = await response.json();
        if (data.name) uploaded.push(data.name);
    }
    return uploaded;
}

class ImageLoaderGallery {
    constructor(node) {
        this.node = node;
        this.selected = new Set();
        this.lastSelected = -1;
        this.savedMultiNames = this.readSavedMultiNames();
        this.maskEditing = false;
        this.maskTool = "brush";
        this.brushSize = 40;
        this.drawing = false;
        this.createUI();
        this.bindWidgets();
        this.render();
    }

    get isSingle() {
        return String(widget(this.node, "upload_mode")?.value || "append") === "replace";
    }

    createUI() {
        const root = document.createElement("div");
        root.className = "wzq-image-loader";
        root.style.cssText = "width:100%;height:100%;min-height:300px;box-sizing:border-box;display:flex;gap:7px;padding:7px;overflow:hidden;background:#141414;border:1px solid var(--border-color);border-radius:6px;position:relative;user-select:none;";

        this.sidebar = document.createElement("div");
        this.sidebar.style.cssText = "flex:0 0 62px;display:flex;flex-direction:column;gap:6px;z-index:3;";
        this.uploadButton = button("上传", "上传图片，可多选或拖入");
        this.inputButton = button(".input", "从 ComfyUI input 目录选择");
        this.outputButton = button(".output", "从 ComfyUI output 目录选择");
        this.removeButton = button("删除", "从当前列表移除选中图片");
        this.clearButton = button("清空", "清空当前列表");
        for (const item of [this.uploadButton, this.inputButton, this.outputButton, this.removeButton, this.clearButton]) {
            this.sidebar.appendChild(item);
        }

        this.maskGroup = document.createElement("div");
        this.maskGroup.style.cssText = "display:none;flex-direction:column;gap:5px;margin-top:4px;";
        this.maskToggle = button("遮罩:关", "开启遮罩绘制");
        this.brushButton = button("画笔");
        this.eraserButton = button("橡皮");
        this.invertButton = button("反相");
        this.maskClearButton = button("清遮罩");
        this.brushRange = document.createElement("input");
        this.brushRange.type = "range";
        this.brushRange.min = "1";
        this.brushRange.max = "300";
        this.brushRange.value = String(this.brushSize);
        this.brushRange.title = "画笔大小";
        for (const item of [this.maskToggle, this.brushRange, this.brushButton, this.eraserButton, this.invertButton, this.maskClearButton]) {
            this.maskGroup.appendChild(item);
        }
        this.sidebar.appendChild(this.maskGroup);

        const spacer = document.createElement("div");
        spacer.style.flex = "1";
        this.sidebar.appendChild(spacer);
        this.uploadModeButton = button("多图", "切换单图/多图加载");
        this.outputModeButton = button("批次", "切换批次/列表输出");
        this.sidebar.append(this.uploadModeButton, this.outputModeButton);

        this.stage = document.createElement("div");
        this.stage.style.cssText = "min-width:0;min-height:0;flex:1;position:relative;overflow:auto;background:#222;border:1px solid #444;border-radius:4px;";
        this.grid = document.createElement("div");
        this.grid.style.cssText = "display:grid;grid-template-columns:repeat(auto-fill,144px);grid-auto-rows:144px;justify-content:start;align-content:start;gap:4px;padding:4px;box-sizing:border-box;min-height:100%;";
        this.grid.addEventListener("dragover", (event) => {
            if (this.dragFrom == null) return;
            event.preventDefault();
            event.stopPropagation();
            event.dataTransfer.dropEffect = "move";
            if (!event.target.closest("[data-wzq-sort-card]")) {
                this.dragInsert = namesOf(this.node).length;
                this.clearDropMarkers();
            }
        });
        this.grid.addEventListener("drop", (event) => {
            if (this.dragFrom == null || event.target.closest("[data-wzq-sort-card]")) return;
            event.preventDefault();
            event.stopPropagation();
            this.commitSort(namesOf(this.node).length);
        });
        this.single = document.createElement("div");
        this.single.style.cssText = "display:none;position:absolute;inset:0;overflow:hidden;background:#222;";
        this.singleImage = document.createElement("img");
        this.singleImage.draggable = false;
        this.singleImage.style.cssText = "position:absolute;object-fit:contain;pointer-events:none;";
        this.maskCanvas = document.createElement("canvas");
        this.maskCanvas.style.cssText = "position:absolute;opacity:.55;touch-action:none;cursor:crosshair;display:none;";
        this.single.append(this.singleImage, this.maskCanvas);
        this.stage.append(this.grid, this.single);
        root.append(this.sidebar, this.stage);
        this.root = root;

        this.node.addDOMWidget("wzq_image_gallery", "div", root, {
            serialize: false,
            getMinHeight: () => 300,
        });

        this.uploadButton.onclick = () => this.openUpload();
        this.inputButton.onclick = () => this.openFolder("input");
        this.outputButton.onclick = () => this.openFolder("output");
        this.removeButton.onclick = () => this.removeSelected();
        this.clearButton.onclick = () => { setNames(this.node, []); this.selected.clear(); this.render(); };
        this.uploadModeButton.onclick = () => this.toggleUploadMode();
        this.outputModeButton.onclick = () => this.toggleOutputMode();
        this.maskToggle.onclick = () => { this.maskEditing = !this.maskEditing; this.updateControls(); };
        this.brushButton.onclick = () => { this.maskTool = "brush"; this.updateControls(); };
        this.eraserButton.onclick = () => { this.maskTool = "eraser"; this.updateControls(); };
        this.invertButton.onclick = () => this.invertMask();
        this.maskClearButton.onclick = () => this.clearMask();
        this.brushRange.oninput = () => { this.brushSize = Number(this.brushRange.value) || 1; };
        this.singleImage.onload = () => this.layoutSingle(true);
        this.stageResize = new ResizeObserver(() => this.layoutSingle(false));
        this.stageResize.observe(this.stage);
        this.bindMaskDrawing();
        this.bindDrop();
        this.bindCanvasWheel();
    }

    bindWidgets() {
        for (const name of ["image_list", "index", "batch_mode", "upload_mode"]) {
            const item = widget(this.node, name);
            if (!item) continue;
            const original = item.callback;
            item.callback = (value) => {
                original?.call(item, value);
                this.render();
            };
        }
    }

    bindDrop() {
        this.root.addEventListener("dragover", (event) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
        });
        this.root.addEventListener("drop", async (event) => {
            event.preventDefault();
            event.stopPropagation();
            const files = [...(event.dataTransfer?.files || [])];
            if (files.length) await this.addUploaded(files);
        });
    }

    bindCanvasWheel() {
        this.canvasWheelHandler = (event) => {
            const canvas = app.canvas?.canvas;
            if (!canvas || event.target === canvas) return;
            event.preventDefault();
            event.stopPropagation();
            canvas.dispatchEvent(new WheelEvent("wheel", {
                deltaX: event.deltaX,
                deltaY: event.deltaY,
                deltaZ: event.deltaZ,
                deltaMode: event.deltaMode,
                clientX: event.clientX,
                clientY: event.clientY,
                ctrlKey: event.ctrlKey,
                shiftKey: event.shiftKey,
                altKey: event.altKey,
                metaKey: event.metaKey,
                bubbles: true,
                cancelable: true,
            }));
        };
        this.root.addEventListener("wheel", this.canvasWheelHandler, { passive: false });
        requestAnimationFrame(() => {
            const parent = this.root.parentElement;
            if (!parent || parent === this.root) return;
            this.wheelParent = parent;
            parent.addEventListener("wheel", this.canvasWheelHandler, { passive: false });
        });
    }

    readSavedMultiNames() {
        const value = this.node.properties?.wzq_image_loader_multi_list;
        return String(value || "")
            .replace(/\r/g, "")
            .split("\n")
            .map((name) => name.trim())
            .filter(Boolean);
    }

    hasSavedMultiNames() {
        return Object.prototype.hasOwnProperty.call(
            this.node.properties || {},
            "wzq_image_loader_multi_list",
        );
    }

    saveMultiNames(names) {
        this.savedMultiNames = [...new Set((names || []).filter(Boolean))];
        this.node.properties ||= {};
        this.node.properties.wzq_image_loader_multi_list = this.savedMultiNames.join("\n");
    }

    openUpload() {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "image/*";
        input.multiple = !this.isSingle;
        input.onchange = async () => this.addUploaded([...input.files]);
        input.click();
    }

    async addUploaded(files) {
        try {
            const uploaded = await uploadImages(files);
            if (!uploaded.length) return;
            const current = namesOf(this.node);
            setNames(this.node, this.isSingle ? [uploaded[0]] : [...uploaded, ...current]);
            setWidget(this.node, "index", 0);
            this.selected = new Set([0]);
            this.clearMask();
            this.render();
        } catch (error) {
            notify(`上传失败：${error.message || error}`);
        }
    }

    async openFolder(source) {
        let files = [];
        let folders = [];
        let currentFolder = "";
        let parentFolder = "";
        const fetchFolder = async (folder = "") => {
            const response = await api.fetchApi(
                `/wzq/image-loader/files?source=${source}&folder=${encodeURIComponent(folder)}`,
            );
            if (!response.ok) throw new Error(await response.text());
            const data = await response.json();
            files = Array.isArray(data.files) ? data.files : [];
            folders = Array.isArray(data.folders) ? data.folders : [];
            currentFolder = String(data.folder || "");
            parentFolder = String(data.parent || "");
        };
        try {
            await fetchFolder("");
        } catch (error) {
            notify(`读取 ${source} 目录失败：${error.message || error}`);
            return;
        }

        const overlay = document.createElement("div");
        overlay.style.cssText = "position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.68);display:flex;align-items:center;justify-content:center;padding:24px;";
        const dialog = document.createElement("div");
        dialog.style.cssText = "width:min(1100px,92vw);height:min(760px,86vh);display:flex;flex-direction:column;background:var(--comfy-menu-bg);border:1px solid var(--border-color);border-radius:8px;overflow:hidden;color:var(--input-text);";
        const header = document.createElement("div");
        header.style.cssText = "display:flex;gap:10px;align-items:center;padding:10px 12px;border-bottom:1px solid var(--border-color);";
        header.innerHTML = `<strong>从 .${source} 目录选择</strong>`;
        const backButton = button("← 上级", "返回上级文件夹");
        backButton.style.width = "auto";
        const pathLabel = document.createElement("div");
        pathLabel.style.cssText = "max-width:380px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--descrip-text);font-size:12px;";
        header.append(backButton, pathLabel);
        const search = document.createElement("input");
        search.placeholder = "搜索文件名...";
        search.style.cssText = "margin-left:auto;width:240px;padding:6px 9px;background:var(--comfy-input-bg);color:var(--input-text);border:1px solid var(--border-color);border-radius:5px;";
        header.appendChild(search);
        const gallery = document.createElement("div");
        gallery.style.cssText = "flex:1;min-height:0;overflow:auto;position:relative;";
        const virtualContent = document.createElement("div");
        virtualContent.style.cssText = "position:relative;width:100%;min-height:100%;";
        gallery.appendChild(virtualContent);
        const footer = document.createElement("div");
        footer.style.cssText = "display:flex;gap:8px;align-items:center;padding:9px 12px;border-top:1px solid var(--border-color);";
        const selection = new Set();
        const count = document.createElement("span");
        count.style.marginRight = "auto";
        const allButton = button("全选");
        const noneButton = button("取消选择");
        const diskDelete = button("删除文件", "从磁盘永久删除选中文件");
        const cancel = button("取消");
        const confirm = button("添加");
        for (const item of [allButton, noneButton, diskDelete, cancel, confirm]) item.style.width = "auto";
        footer.append(count, allButton, noneButton, diskDelete, cancel, confirm);
        dialog.append(header, gallery, footer);
        overlay.appendChild(dialog);
        document.body.appendChild(overlay);

        const searchValue = () => search.value.trim().toLowerCase();
        const visibleFiles = () => files.filter((file) => String(file.display_name || file.name).toLowerCase().includes(searchValue()));
        const visibleFolders = () => folders.filter((folder) => folder.name.toLowerCase().includes(searchValue()));
        const updatePath = () => {
            pathLabel.textContent = currentFolder ? `/${currentFolder}` : "/";
            pathLabel.title = `.${source}/${currentFolder}`;
            backButton.disabled = !currentFolder;
            backButton.style.opacity = currentFolder ? "1" : ".4";
            backButton.style.cursor = currentFolder ? "pointer" : "default";
        };
        const updateCount = () => {
            count.textContent = `已选择 ${selection.size} 张 / 当前目录 ${files.length} 张，${folders.length} 个文件夹`;
        };
        const CARD_SIZE = 160;
        const CARD_GAP = 6;
        const GRID_PADDING = 8;
        const OVERSCAN_ROWS = 2;
        let filteredItems = [];
        let galleryRenderRaf = null;

        const positionCard = (card, index, columns) => {
            const column = index % columns;
            const row = Math.floor(index / columns);
            card.style.position = "absolute";
            card.style.left = `${GRID_PADDING + column * (CARD_SIZE + CARD_GAP)}px`;
            card.style.top = `${GRID_PADDING + row * (CARD_SIZE + CARD_GAP)}px`;
            card.style.width = `${CARD_SIZE}px`;
            card.style.height = `${CARD_SIZE}px`;
            card.style.boxSizing = "border-box";
        };

        const createFolderCard = (folder) => {
            const card = document.createElement("div");
            card.style.cssText = "overflow:hidden;background:#303030;border:2px solid #555;border-radius:5px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:filter .12s ease;";
            const icon = document.createElement("div");
            icon.textContent = "📁";
            icon.style.cssText = "font-size:72px;line-height:1;transform:translateY(-5px);";
            const label = document.createElement("div");
            label.textContent = folder.name;
            label.title = folder.path;
            label.style.cssText = "position:absolute;left:0;right:0;bottom:0;padding:5px 6px;background:rgba(0,0,0,.72);font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:center;";
            card.append(icon, label);
            card.onmouseenter = () => { card.style.filter = "brightness(1.15)"; };
            card.onmouseleave = () => { card.style.filter = ""; };
            card.onclick = async () => {
                try {
                    await fetchFolder(folder.path);
                    search.value = "";
                    rebuildItems();
                    updatePath();
                    updateCount();
                } catch (error) {
                    notify(`读取文件夹失败：${error.message || error}`);
                }
            };
            return card;
        };

        const createFileCard = (file) => {
            const card = document.createElement("div");
            card.style.cssText = `overflow:hidden;background:#333;border:2px solid ${selection.has(file.name) ? "#69ce6d" : "#555"};border-radius:5px;cursor:pointer;transition:filter .12s ease;`;
            const image = document.createElement("img");
            image.loading = "lazy";
            image.draggable = false;
            image.src = thumbUrl(annotated(file.name, source));
            image.style.cssText = "width:100%;height:100%;object-fit:contain;display:block;";
            const label = document.createElement("div");
            label.textContent = file.display_name || file.name.split("/").pop();
            label.title = file.name;
            label.style.cssText = "position:absolute;left:0;right:0;bottom:0;padding:4px 6px;background:rgba(0,0,0,.72);font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
            card.append(image, label);
            card.onmouseenter = () => { card.style.filter = "brightness(1.15)"; };
            card.onmouseleave = () => { card.style.filter = ""; };
            card.onclick = () => {
                if (this.isSingle) selection.clear();
                selection.has(file.name) ? selection.delete(file.name) : selection.add(file.name);
                renderFiles();
                updateCount();
            };
            return card;
        };

        const renderFiles = () => {
            galleryRenderRaf = null;
            const availableWidth = Math.max(CARD_SIZE, gallery.clientWidth - GRID_PADDING * 2);
            const columns = Math.max(1, Math.floor((availableWidth + CARD_GAP) / (CARD_SIZE + CARD_GAP)));
            const rowHeight = CARD_SIZE + CARD_GAP;
            const totalRows = Math.ceil(filteredItems.length / columns);
            const contentHeight = GRID_PADDING * 2 + Math.max(0, totalRows * rowHeight - CARD_GAP);
            virtualContent.style.height = `${Math.max(gallery.clientHeight, contentHeight)}px`;

            const startRow = Math.max(0, Math.floor((gallery.scrollTop - GRID_PADDING) / rowHeight) - OVERSCAN_ROWS);
            const visibleRows = Math.ceil(gallery.clientHeight / rowHeight) + OVERSCAN_ROWS * 2;
            const startIndex = Math.min(filteredItems.length, startRow * columns);
            const endIndex = Math.min(filteredItems.length, (startRow + visibleRows) * columns);
            const fragment = document.createDocumentFragment();
            for (let index = startIndex; index < endIndex; index++) {
                const item = filteredItems[index];
                const card = item.kind === "folder"
                    ? createFolderCard(item.value)
                    : createFileCard(item.value);
                positionCard(card, index, columns);
                fragment.appendChild(card);
            }
            virtualContent.replaceChildren(fragment);
        };

        const scheduleRender = () => {
            if (galleryRenderRaf != null) return;
            galleryRenderRaf = requestAnimationFrame(renderFiles);
        };

        const rebuildItems = (resetScroll = true) => {
            filteredItems = [
                ...visibleFolders().map((value) => ({ kind: "folder", value })),
                ...visibleFiles().map((value) => ({ kind: "file", value })),
            ];
            if (resetScroll) gallery.scrollTop = 0;
            renderFiles();
        };

        gallery.addEventListener("scroll", scheduleRender, { passive: true });
        const galleryResizeObserver = new ResizeObserver(scheduleRender);
        galleryResizeObserver.observe(gallery);
        const closeDialog = () => {
            galleryResizeObserver.disconnect();
            if (galleryRenderRaf != null) cancelAnimationFrame(galleryRenderRaf);
            overlay.remove();
        };
        search.oninput = () => rebuildItems();
        backButton.onclick = async () => {
            if (!currentFolder) return;
            try {
                await fetchFolder(parentFolder);
                search.value = "";
                rebuildItems();
                updatePath();
                updateCount();
            } catch (error) {
                notify(`读取上级文件夹失败：${error.message || error}`);
            }
        };
        allButton.onclick = () => { for (const file of visibleFiles()) selection.add(file.name); renderFiles(); updateCount(); };
        noneButton.onclick = () => { selection.clear(); renderFiles(); updateCount(); };
        cancel.onclick = closeDialog;
        overlay.onclick = (event) => { if (event.target === overlay) closeDialog(); };
        confirm.onclick = () => {
            const chosen = [...selection].map((name) => annotated(name, source));
            if (chosen.length) {
                setNames(this.node, this.isSingle ? [chosen[0]] : [...chosen, ...namesOf(this.node)]);
                setWidget(this.node, "index", 0);
                this.selected = new Set([0]);
                this.clearMask();
            }
            closeDialog();
            this.render();
        };
        diskDelete.onclick = async () => {
            if (!selection.size || !window.confirm(`确定从磁盘删除 ${selection.size} 个文件吗？此操作不可撤销。`)) return;
            try {
                const response = await api.fetchApi("/wzq/image-loader/delete", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ source, files: [...selection] }),
                });
                const result = await response.json();
                const deleted = new Set(result.deleted || []);
                files = files.filter((file) => !deleted.has(file.name));
                for (const name of deleted) selection.delete(name);
                rebuildItems(false);
                updateCount();
                if (result.errors?.length) notify(result.errors.join("\n"));
            } catch (error) {
                notify(`删除失败：${error.message || error}`);
            }
        };
        rebuildItems();
        updatePath();
        updateCount();
    }

    removeSelected() {
        const names = namesOf(this.node);
        if (!names.length) return;
        const indexes = this.selected.size ? this.selected : new Set([Number(widget(this.node, "index")?.value) || 0]);
        const remaining = names.filter((_, index) => !indexes.has(index));
        setNames(this.node, remaining);
        setWidget(this.node, "index", Math.min(Number(widget(this.node, "index")?.value) || 0, Math.max(0, remaining.length - 1)));
        this.selected.clear();
        this.clearMask();
        this.render();
    }

    toggleUploadMode() {
        const enteringSingle = !this.isSingle;
        if (enteringSingle) {
            const names = namesOf(this.node);
            const currentIndex = Math.max(0, Math.min(
                Number(widget(this.node, "index")?.value) || 0,
                Math.max(0, names.length - 1),
            ));
            this.saveMultiNames(names);
            this.node.properties.wzq_image_loader_multi_batch_mode = Boolean(widget(this.node, "batch_mode")?.value);
            setWidget(this.node, "upload_mode", "replace");
            setNames(this.node, names.length ? [names[currentIndex]] : []);
            setWidget(this.node, "index", 0);
            setWidget(this.node, "batch_mode", false);
            this.selected = new Set([0]);
        } else {
            const hasSaved = this.hasSavedMultiNames();
            const saved = this.savedMultiNames.length ? this.savedMultiNames : this.readSavedMultiNames();
            const currentSingleNames = namesOf(this.node);
            const currentSingleIndex = Math.max(0, Math.min(
                Number(widget(this.node, "index")?.value) || 0,
                Math.max(0, currentSingleNames.length - 1),
            ));
            const currentSingleName = currentSingleNames[currentSingleIndex] || "";
            const restored = hasSaved ? [...saved] : [...currentSingleNames];
            let selectedIndex = currentSingleName ? restored.indexOf(currentSingleName) : 0;
            if (currentSingleName && selectedIndex < 0) {
                restored.unshift(currentSingleName);
                selectedIndex = 0;
            }
            selectedIndex = Math.max(0, Math.min(selectedIndex, Math.max(0, restored.length - 1)));
            setWidget(this.node, "upload_mode", "append");
            setNames(this.node, restored);
            this.saveMultiNames(restored);
            if (Object.prototype.hasOwnProperty.call(this.node.properties || {}, "wzq_image_loader_multi_batch_mode")) {
                setWidget(this.node, "batch_mode", Boolean(this.node.properties.wzq_image_loader_multi_batch_mode));
            }
            setWidget(this.node, "index", selectedIndex);
            this.selected = restored.length ? new Set([selectedIndex]) : new Set();
            this.lastSelected = restored.length ? selectedIndex : -1;
            this.maskEditing = false;
        }
        this.clearMask();
        this.render();
    }

    toggleOutputMode() {
        if (this.isSingle || namesOf(this.node).length <= 1) return;
        setWidget(this.node, "batch_mode", !Boolean(widget(this.node, "batch_mode")?.value));
        this.updateControls();
    }

    render() {
        const names = namesOf(this.node);
        let current = Number(widget(this.node, "index")?.value) || 0;
        current = Math.max(0, Math.min(current, Math.max(0, names.length - 1)));
        if (this.isSingle) {
            this.grid.style.display = "none";
            this.single.style.display = "block";
            const source = names[current] || "";
            if (source && this.singleImage.dataset.name !== source) {
                this.singleImage.dataset.name = source;
                this.singleImage.src = thumbUrl(source);
            } else if (!source) {
                this.singleImage.removeAttribute("src");
                this.singleImage.dataset.name = "";
                this.clearMask();
            }
        } else {
            this.single.style.display = "none";
            this.grid.style.display = "grid";
            this.grid.replaceChildren();
            names.forEach((name, index) => {
                const card = document.createElement("div");
                const selected = this.selected.has(index) || (!this.selected.size && index === current);
                card.style.cssText = `position:relative;min-width:0;min-height:100px;overflow:hidden;background:#3a3a3a;border:2px solid ${selected ? (widget(this.node, "batch_mode")?.value ? "#69ce6d" : "#6699ff") : "#555"};border-radius:3px;cursor:grab;transition:filter .12s ease;`;
                card.dataset.wzqSortCard = "1";
                card.draggable = true;
                const image = document.createElement("img");
                image.loading = "lazy";
                image.draggable = false;
                image.src = thumbUrl(name);
                image.style.cssText = "width:100%;height:100%;object-fit:contain;display:block;";
                const label = document.createElement("div");
                label.textContent = splitAnnotated(name).name.split("/").pop();
                label.title = name;
                label.style.cssText = "position:absolute;left:0;right:0;bottom:0;padding:3px 5px;background:rgba(0,0,0,.62);color:#eee;font-size:9px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:center;";
                card.append(image, label);
                card.addEventListener("mouseenter", () => {
                    if (this.dragFrom == null) card.style.filter = "brightness(1.15)";
                });
                card.addEventListener("mouseleave", () => {
                    card.style.filter = "";
                });
                card.onclick = (event) => {
                    if (this.suppressCardClick) return;
                    this.selectCard(event, index, names.length);
                };
                card.addEventListener("dragstart", (event) => this.beginSort(event, card, index));
                card.addEventListener("dragover", (event) => this.updateSortTarget(event, card, index));
                card.addEventListener("drop", (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    this.commitSort(this.dragInsert ?? index);
                });
                card.addEventListener("dragend", () => this.endSort());
                this.grid.appendChild(card);
            });
        }
        this.updateControls();
    }

    selectCard(event, index, count) {
        if (event.shiftKey && this.lastSelected >= 0) {
            const start = Math.min(this.lastSelected, index);
            const end = Math.max(this.lastSelected, index);
            if (!event.ctrlKey) this.selected.clear();
            for (let item = start; item <= end; item++) this.selected.add(item);
        } else if (event.ctrlKey || event.metaKey) {
            this.selected.has(index) ? this.selected.delete(index) : this.selected.add(index);
        } else {
            this.selected = new Set([index]);
        }
        this.lastSelected = Math.max(0, Math.min(index, count - 1));
        const firstSelected = this.selected.size
            ? Math.min(...this.selected)
            : 0;
        setWidget(this.node, "index", firstSelected);
        this.render();
    }

    beginSort(event, card, index) {
        if (this.isSingle) {
            event.preventDefault();
            return;
        }
        this.dragFrom = index;
        this.dragInsert = index;
        this.dragCommitted = false;
        this.selected = new Set([index]);
        this.lastSelected = index;
        card.style.opacity = ".35";
        card.style.borderColor = "#ffd75a";
        card.style.cursor = "grabbing";
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", String(index));

        const rect = card.getBoundingClientRect();
        const ghost = card.cloneNode(true);
        ghost.style.cssText += `;position:fixed;left:-10000px;top:-10000px;width:${rect.width}px;height:${rect.height}px;opacity:.92;box-shadow:0 10px 28px rgba(0,0,0,.65);pointer-events:none;`;
        document.body.appendChild(ghost);
        event.dataTransfer.setDragImage(ghost, rect.width / 2, rect.height / 2);
        setTimeout(() => ghost.remove(), 0);
    }

    updateSortTarget(event, card, index) {
        if (this.dragFrom == null) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = "move";
        const rect = card.getBoundingClientRect();
        const insertAfter = event.clientX >= rect.left + rect.width / 2;
        this.dragInsert = index + (insertAfter ? 1 : 0);
        this.clearDropMarkers();
        card.style.boxShadow = insertAfter
            ? "inset -4px 0 #ffd75a"
            : "inset 4px 0 #ffd75a";
    }

    clearDropMarkers() {
        this.grid.querySelectorAll("[data-wzq-sort-card]").forEach((card) => {
            card.style.boxShadow = "";
        });
    }

    commitSort(insertPosition) {
        if (this.dragFrom == null) return;
        const names = namesOf(this.node);
        const from = this.dragFrom;
        if (from < 0 || from >= names.length) {
            this.endSort();
            return;
        }
        let target = Math.max(0, Math.min(Number(insertPosition) || 0, names.length));
        const [moved] = names.splice(from, 1);
        if (target > from) target -= 1;
        target = Math.max(0, Math.min(target, names.length));
        names.splice(target, 0, moved);

        this.dragCommitted = true;
        this.suppressCardClick = true;
        this.selected = new Set([target]);
        this.lastSelected = target;
        setNames(this.node, names);
        setWidget(this.node, "index", target);
        this.saveMultiNames(names);
        this.endSort();
        setTimeout(() => { this.suppressCardClick = false; }, 0);
    }

    endSort() {
        const from = this.dragFrom;
        const committed = this.dragCommitted;
        this.dragFrom = null;
        this.dragInsert = null;
        this.dragCommitted = false;
        this.clearDropMarkers();
        if (!committed && from != null) {
            this.selected = new Set([from]);
            this.lastSelected = from;
            setWidget(this.node, "index", from);
        }
        this.render();
    }

    updateControls() {
        const count = namesOf(this.node).length;
        const batch = Boolean(widget(this.node, "batch_mode")?.value);
        this.uploadModeButton.textContent = this.isSingle ? "单图" : "多图";
        this.uploadModeButton.style.color = "#ff7777";
        this.maskGroup.style.display = this.isSingle && count ? "flex" : "none";
        this.outputModeButton.textContent = batch ? "批次" : "列表";
        this.outputModeButton.style.borderColor = batch ? "#69ce6d" : "#6699ff";
        this.outputModeButton.style.opacity = this.isSingle || count <= 1 ? ".4" : "1";
        this.outputModeButton.style.cursor = this.isSingle || count <= 1 ? "default" : "pointer";
        this.maskToggle.textContent = this.maskEditing ? "退出遮罩" : "遮罩:关";
        this.maskToggle.style.borderColor = this.maskEditing ? "#ff7777" : "var(--border-color)";
        this.brushButton.style.borderColor = this.maskTool === "brush" ? "#69ce6d" : "var(--border-color)";
        this.eraserButton.style.borderColor = this.maskTool === "eraser" ? "#ff7777" : "var(--border-color)";
        this.maskCanvas.style.display = this.isSingle && count ? "block" : "none";
        this.maskCanvas.style.pointerEvents = this.maskEditing ? "auto" : "none";
    }

    layoutSingle(resetCanvas) {
        if (!this.isSingle || !this.singleImage.naturalWidth) return;
        const width = this.stage.clientWidth;
        const height = this.stage.clientHeight;
        const scale = Math.min(width / this.singleImage.naturalWidth, height / this.singleImage.naturalHeight);
        const drawWidth = Math.max(1, Math.round(this.singleImage.naturalWidth * scale));
        const drawHeight = Math.max(1, Math.round(this.singleImage.naturalHeight * scale));
        const left = Math.round((width - drawWidth) / 2);
        const top = Math.round((height - drawHeight) / 2);
        for (const element of [this.singleImage, this.maskCanvas]) {
            element.style.left = `${left}px`;
            element.style.top = `${top}px`;
            element.style.width = `${drawWidth}px`;
            element.style.height = `${drawHeight}px`;
        }
        if (resetCanvas || this.maskCanvas.width !== this.singleImage.naturalWidth || this.maskCanvas.height !== this.singleImage.naturalHeight) {
            this.maskCanvas.width = this.singleImage.naturalWidth;
            this.maskCanvas.height = this.singleImage.naturalHeight;
            const data = String(widget(this.node, "mask_data")?.value || "");
            if (data) {
                const mask = new Image();
                mask.onload = () => this.maskCanvas.getContext("2d").drawImage(mask, 0, 0, this.maskCanvas.width, this.maskCanvas.height);
                mask.src = data;
            }
        }
    }

    bindMaskDrawing() {
        const point = (event) => {
            const rect = this.maskCanvas.getBoundingClientRect();
            return {
                x: (event.clientX - rect.left) * this.maskCanvas.width / rect.width,
                y: (event.clientY - rect.top) * this.maskCanvas.height / rect.height,
            };
        };
        const draw = (event) => {
            if (!this.drawing) return;
            const next = point(event);
            const ctx = this.maskCanvas.getContext("2d");
            ctx.save();
            ctx.lineWidth = this.brushSize;
            ctx.lineCap = "round";
            ctx.lineJoin = "round";
            ctx.strokeStyle = "white";
            ctx.globalCompositeOperation = this.maskTool === "eraser" || event.buttons === 2 ? "destination-out" : "source-over";
            ctx.beginPath();
            ctx.moveTo(this.lastMaskPoint.x, this.lastMaskPoint.y);
            ctx.lineTo(next.x, next.y);
            ctx.stroke();
            ctx.restore();
            this.lastMaskPoint = next;
        };
        this.maskCanvas.oncontextmenu = (event) => event.preventDefault();
        this.maskCanvas.onpointerdown = (event) => {
            if (!this.maskEditing) return;
            event.preventDefault();
            this.drawing = true;
            this.lastMaskPoint = point(event);
            this.maskCanvas.setPointerCapture(event.pointerId);
            draw(event);
        };
        this.maskCanvas.onpointermove = draw;
        const finish = () => {
            if (!this.drawing) return;
            this.drawing = false;
            setWidget(this.node, "mask_data", this.maskCanvas.toDataURL("image/png"));
        };
        this.maskCanvas.onpointerup = finish;
        this.maskCanvas.onpointercancel = finish;
    }

    clearMask() {
        const ctx = this.maskCanvas.getContext("2d");
        ctx.clearRect(0, 0, this.maskCanvas.width, this.maskCanvas.height);
        setWidget(this.node, "mask_data", "");
    }

    invertMask() {
        if (!this.maskCanvas.width) return;
        const ctx = this.maskCanvas.getContext("2d");
        const image = ctx.getImageData(0, 0, this.maskCanvas.width, this.maskCanvas.height);
        for (let index = 0; index < image.data.length; index += 4) {
            const value = 255 - image.data[index + 3];
            image.data[index] = 255;
            image.data[index + 1] = 255;
            image.data[index + 2] = 255;
            image.data[index + 3] = value;
        }
        ctx.putImageData(image, 0, 0);
        setWidget(this.node, "mask_data", this.maskCanvas.toDataURL("image/png"));
    }

    destroy() {
        this.stageResize?.disconnect();
        this.root?.removeEventListener("wheel", this.canvasWheelHandler);
        this.wheelParent?.removeEventListener("wheel", this.canvasWheelHandler);
    }
}

function hideWidget(item) {
    if (!item) return;
    item.type = "hidden";
    item.hidden = true;
    item.computeSize = () => [0, 0];
}

function ensureWidget(node, name, defaultValue) {
    let item = widget(node, name);
    if (!item) item = node.addWidget("text", name, defaultValue, null, { serialize: true });
    if (item.value == null) item.value = defaultValue;
    hideWidget(item);
    return item;
}

function ensureOutputSlots(node) {
    const outputs = Array.isArray(node.outputs) ? node.outputs : [];
    const primary = outputs[0] || { links: null };
    const oldMaskIndex = outputs.findIndex((output) => output?.type === "MASK");
    const mask = oldMaskIndex >= 0 ? outputs[oldMaskIndex] : { links: null };
    const single = outputs.find((output, index) => index > 0 && output?.type === "IMAGE") || { links: null };

    Object.assign(primary, { type: "IMAGE", name: "图像", label: "图像", slot_index: 0 });
    Object.assign(single, { type: "IMAGE", name: "单图", label: "单图", slot_index: 1 });
    Object.assign(mask, { type: "MASK", name: "遮罩", label: "遮罩", slot_index: 2 });
    node.outputs = [primary, single, mask];

    if (oldMaskIndex >= 0 && oldMaskIndex !== 2 && Array.isArray(mask.links)) {
        for (const linkId of mask.links) {
            const link = app.graph?.links?.[linkId] ?? app.graph?.links?.get?.(linkId);
            if (link && String(link.origin_id) === String(node.id)) link.origin_slot = 2;
        }
    }
}

app.registerExtension({
    name: "wzq.image_loader",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== NODE_NAME) return;
        nodeData.output = ["IMAGE", "IMAGE", "MASK"];
        nodeData.output_name = ["图像", "单图", "遮罩"];
        nodeData.output_is_list = [true, false, false];
        nodeData.outputs = [
            { type: "IMAGE", name: "图像", label: "图像" },
            { type: "IMAGE", name: "单图", label: "单图" },
            { type: "MASK", name: "遮罩", label: "遮罩" },
        ];
        const originalCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const result = originalCreated?.apply(this, arguments);
            ensureOutputSlots(this);
            for (const name of ["image_list", "index", "batch_mode"]) hideWidget(widget(this, name));
            ensureWidget(this, "mask_data", "");
            ensureWidget(this, "upload_mode", "append");
            this.setSize([Math.max(560, this.size?.[0] || 0), Math.max(520, this.size?.[1] || 0)]);
            this.minWidth = Math.max(420, this.minWidth || 0);
            this.minHeight = Math.max(360, this.minHeight || 0);
            this._wzqImageGallery = new ImageLoaderGallery(this);
            return result;
        };

        const originalConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function () {
            const result = originalConfigure?.apply(this, arguments);
            ensureOutputSlots(this);
            setTimeout(() => {
                ensureOutputSlots(this);
                this._wzqImageGallery?.render();
            }, 0);
            return result;
        };

        const originalRemoved = nodeType.prototype.onRemoved;
        nodeType.prototype.onRemoved = function () {
            this._wzqImageGallery?.destroy();
            return originalRemoved?.apply(this, arguments);
        };
    },
});
