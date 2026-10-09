import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";

const NODE_NAME = "WZQPromptManager";
const NODE_WIDTH = 660;
const NODE_HEIGHT = 470;
const PANEL_MIN_HEIGHT = 402;
const TREE_ROW_HEIGHT = 30;
const TREE_OVERSCAN = 6;
const SEARCH_DELAY = 150;
const NAME_ORDER = new Intl.Collator("zh-CN", { sensitivity: "base", numeric: true });

let sharedLibrary = null;
let sharedLibraryPromise = null;
let sharedLibraryGeneration = 0;

const ICONS = {
    chevron: `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5.5 3.75 10 8l-4.5 4.25"/></svg>`,
    folder: `<svg viewBox="0 0 18 16" aria-hidden="true"><path d="M1.5 3.25A1.75 1.75 0 0 1 3.25 1.5h3.1l1.5 1.75h6.9A1.75 1.75 0 0 1 16.5 5v7.25A1.75 1.75 0 0 1 14.75 14H3.25a1.75 1.75 0 0 1-1.75-1.75Z"/></svg>`,
    document: `<svg viewBox="0 0 16 18" aria-hidden="true"><path d="M3 1.5h6l4 4v10A1.5 1.5 0 0 1 11.5 17h-8A1.5 1.5 0 0 1 2 15.5V3A1.5 1.5 0 0 1 3.5 1.5Z"/><path d="M9 1.75V5.5h3.75M5 9h6M5 12h6"/></svg>`,
};

const findWidget = (node, name) => node.widgets?.find((item) => item.name === name);

function currentPromptName(date = new Date()) {
    const pad = (value) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
}

function hidePromptWidget(item) {
    if (!item) return;
    item.hidden = true;
    item.options = item.options || {};
    item.options.hidden = true;
    item.computeSize = () => [0, -4];
    item.serialize = true;
    const element = item.element || item.inputEl;
    element?.style.setProperty("display", "none", "important");
}

function errorMessage(payload, fallback) {
    return payload?.error || fallback;
}

async function jsonResponse(response) {
    let payload = null;
    try { payload = await response.json(); } catch {}
    if (!response.ok) {
        const error = new Error(errorMessage(payload, `请求失败 (${response.status})`));
        error.status = response.status;
        error.payload = payload;
        throw error;
    }
    return payload || {};
}

function normalizeLibrary(payload) {
    const categories = Array.isArray(payload?.categories) ? payload.categories : [];
    return categories.map((category) => ({
        ...category,
        _search: String(category.path || category.name || "").toLocaleLowerCase(),
        prompts: (Array.isArray(category.prompts) ? category.prompts : []).map((prompt) => ({
            ...prompt,
            _search: String(prompt.name || "").toLocaleLowerCase(),
        })).sort((a, b) => NAME_ORDER.compare(a.name, b.name)),
    })).sort((a, b) => NAME_ORDER.compare(a.path || a.name, b.path || b.name));
}

function invalidateSharedLibrary() {
    sharedLibraryGeneration += 1;
    sharedLibrary = null;
    sharedLibraryPromise = null;
}

async function getSharedLibrary(forceRefresh = false) {
    if (forceRefresh) invalidateSharedLibrary();
    if (sharedLibrary) return sharedLibrary;
    if (sharedLibraryPromise) return sharedLibraryPromise;

    const generation = sharedLibraryGeneration;
    const url = `/wzq/prompt-manager/list${forceRefresh ? "?refresh=1" : ""}`;
    const request = (async () => {
        const response = await api.fetchApi(url, { cache: "no-store" });
        const categories = normalizeLibrary(await jsonResponse(response));
        if (generation === sharedLibraryGeneration) sharedLibrary = categories;
        return categories;
    })();
    sharedLibraryPromise = request;
    try {
        return await request;
    } finally {
        if (sharedLibraryPromise === request) sharedLibraryPromise = null;
    }
}

class PromptManagerPanel {
    constructor(node) {
        this.node = node;
        this.categories = [];
        this.expanded = new Set();
        this.selectedPath = "";
        this.requestSerial = 0;
        this.build();
        this.restore();
        this.refresh();
    }

    build() {
        const root = document.createElement("div");
        root.className = "wzq-pm";
        root.innerHTML = `
          <style>
            .wzq-pm{width:100%;height:100%;box-sizing:border-box;color:#ddd;font:12px/1.35 Arial,"Microsoft YaHei",sans-serif;user-select:none;margin-top:-22px;overflow:hidden}
            .wzq-pm *{box-sizing:border-box}.wzq-pm button,.wzq-pm input,.wzq-pm select{font:inherit}
            .wzq-pm-grid{display:grid;grid-template-columns:226px minmax(0,1fr);gap:10px;height:100%;min-height:0}
            .wzq-pm-column{min-width:0;min-height:0;display:flex;flex-direction:column}
            .wzq-pm-head{height:30px;display:flex;align-items:center;color:#eee;font-size:14px;font-weight:600;flex:0 0 auto}
            .wzq-pm-refresh{margin-left:auto;width:25px;height:25px;padding:0;border:0;border-radius:4px;background:transparent;color:#a9b1b8;cursor:pointer;font-size:17px;line-height:25px}.wzq-pm-refresh:hover{background:#30343a;color:#fff}.wzq-pm-refresh.loading{animation:wzq-pm-spin .8s linear infinite}@keyframes wzq-pm-spin{to{transform:rotate(360deg)}}
            .wzq-pm-search{position:relative;margin-bottom:7px}.wzq-pm-search:before{content:"⌕";position:absolute;left:9px;top:4px;color:#c7cdd3;font-size:19px;pointer-events:none}.wzq-pm-search input{width:100%;height:34px;padding:5px 9px 5px 31px;border:1px solid #41464d;border-radius:5px;background:#202328;color:#e5e8eb;outline:none;user-select:text}.wzq-pm-search input:focus{border-color:#3389c9}.wzq-pm-search input::placeholder{color:#8b9299}
            .wzq-pm-tree{flex:1;min-height:0;overflow:auto;border:1px solid #3b4046;border-radius:5px;background:#181b1f;padding:5px;scrollbar-width:thin}.wzq-pm-tree-content{position:relative;min-height:100%}.wzq-pm-tree-content>.wzq-pm-folder,.wzq-pm-tree-content>.wzq-pm-item{position:absolute;left:0;right:0;width:auto}.wzq-pm-tree-empty{padding:18px 8px;color:#858d94;text-align:center}
            .wzq-pm-folder,.wzq-pm-item{display:flex;align-items:center;width:100%;height:30px;border:0;border-radius:5px;background:transparent;color:#d9dde0;text-align:left;cursor:pointer;white-space:nowrap;overflow:hidden;transition:background-color .12s ease,color .12s ease}.wzq-pm-folder:hover,.wzq-pm-item:hover{background:#292e34}.wzq-pm-item.active{background:#17679f;color:#fff}.wzq-pm-folder{font-weight:600}.wzq-pm-chevron{display:flex;align-items:center;justify-content:center;width:16px;height:16px;margin-right:2px;color:#9ba5ad;flex:0 0 auto}.wzq-pm-chevron svg{display:block;width:12px;height:12px;overflow:visible;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;transition:transform .14s ease}.wzq-pm-folder.expanded .wzq-pm-chevron svg{transform:rotate(90deg)}.wzq-pm-folder-icon,.wzq-pm-doc{display:flex;align-items:center;justify-content:center;width:23px;height:20px;margin-right:3px;flex:0 0 auto}.wzq-pm-folder-icon{color:#55b9eb}.wzq-pm-folder-icon svg{display:block;width:17px;height:15px;fill:currentColor}.wzq-pm-doc{color:#aeb9c1}.wzq-pm-doc svg{display:block;width:14px;height:16px;fill:none;stroke:currentColor;stroke-width:1.35;stroke-linecap:round;stroke-linejoin:round}.wzq-pm-item:hover .wzq-pm-doc{color:#d6e0e6}.wzq-pm-item.active .wzq-pm-doc{color:#fff}.wzq-pm-label{min-width:0;overflow:hidden;text-overflow:ellipsis}
            .wzq-pm-editor-host{display:flex;flex:1;min-height:0;width:100%;overflow:hidden}.wzq-pm-editor{display:block;flex:1;width:100%;height:100%;min-height:0;margin:0;resize:none;box-sizing:border-box;user-select:text}
            .wzq-pm-fields{display:grid;grid-template-columns:auto minmax(0,1fr) 72px;gap:7px;align-items:center;margin-top:8px;color:#d9dde0}.wzq-pm-name,.wzq-pm-category{width:100%;min-width:0;border:1px solid #41464d;border-radius:5px;background:#202328;color:#e7eaed;padding:5px 8px;outline:none;user-select:text}.wzq-pm-name{height:32px}.wzq-pm-name:focus,.wzq-pm-category:focus{border-color:#3389c9}
            .wzq-pm-actions{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1.2fr) minmax(100px,.8fr);gap:8px;margin-top:8px}.wzq-pm-rename,.wzq-pm-new,.wzq-pm-save{border:1px solid #41464d;border-radius:5px;color:#e1e5e8;font-weight:600;cursor:pointer;transition:background-color .12s ease,border-color .12s ease,color .12s ease}.wzq-pm-rename{height:32px;background:#252a30}.wzq-pm-new,.wzq-pm-save,.wzq-pm-category{height:37px}.wzq-pm-new{background:#1d2126;color:#cbd1d6}.wzq-pm-save{background:#252a30}.wzq-pm-rename:hover:not(:disabled),.wzq-pm-new:hover,.wzq-pm-save:hover{border-color:#59616a;background:#30363d;color:#fff}.wzq-pm-rename:active:not(:disabled),.wzq-pm-new:active,.wzq-pm-save:active{background:#20252a}.wzq-pm-rename:focus-visible,.wzq-pm-new:focus-visible,.wzq-pm-save:focus-visible{outline:1px solid #4c91c5;outline-offset:2px}.wzq-pm-rename:disabled{opacity:.45;cursor:not-allowed}.wzq-pm-new:disabled,.wzq-pm-save:disabled{opacity:.55;cursor:wait}
            .wzq-pm-status{display:flex;align-items:center;height:18px;padding-top:4px;color:#7f8991;overflow:hidden;white-space:nowrap}.wzq-pm-status.error{color:#e37d85}.wzq-pm-status.success{color:#74c790}.wzq-pm-status-path{min-width:0;padding:0;border:0;background:transparent;color:inherit;text-decoration:underline;text-overflow:ellipsis;overflow:hidden;white-space:nowrap;cursor:pointer}.wzq-pm-status-path:hover{color:#fff}.wzq-pm-status-path:focus-visible{outline:1px solid #4c91c5;outline-offset:1px}
          </style>
          <div class="wzq-pm-grid">
            <section class="wzq-pm-column">
              <div class="wzq-pm-head">提示词列表<button class="wzq-pm-refresh" type="button" title="刷新">↻</button></div>
              <label class="wzq-pm-search"><input type="search" placeholder="搜索提示词..." autocomplete="off"></label>
              <div class="wzq-pm-tree"></div>
            </section>
            <section class="wzq-pm-column">
              <div class="wzq-pm-head">提示词内容</div>
              <div class="wzq-pm-editor-host"><textarea class="comfy-multiline-input h-full w-full wzq-pm-editor" placeholder="在这里输入提示词..."></textarea></div>
              <div class="wzq-pm-fields">
                <span>名称</span>
                <input class="wzq-pm-name" type="text" maxlength="128" placeholder="提示词名称">
                <button class="wzq-pm-rename" type="button" disabled>改名</button>
              </div>
              <div class="wzq-pm-actions">
                <button class="wzq-pm-new" type="button">新建提示词</button>
                <button class="wzq-pm-save" type="button">添加到提示词列表</button>
                <select class="wzq-pm-category" title="保存到"></select>
              </div>
              <div class="wzq-pm-status"></div>
            </section>
          </div>`;

        this.root = root;
        this.tree = root.querySelector(".wzq-pm-tree");
        this.treeContent = document.createElement("div");
        this.treeContent.className = "wzq-pm-tree-content";
        this.tree.append(this.treeContent);
        this.search = root.querySelector(".wzq-pm-search input");
        this.refreshButton = root.querySelector(".wzq-pm-refresh");
        this.editor = root.querySelector(".wzq-pm-editor");
        this.nameInput = root.querySelector(".wzq-pm-name");
        this.renameButton = root.querySelector(".wzq-pm-rename");
        this.categorySelect = root.querySelector(".wzq-pm-category");
        this.newButton = root.querySelector(".wzq-pm-new");
        this.saveButton = root.querySelector(".wzq-pm-save");
        this.status = root.querySelector(".wzq-pm-status");

        this.search.addEventListener("input", () => {
            clearTimeout(this.searchTimer);
            this.searchTimer = setTimeout(() => {
                this.tree.scrollTop = 0;
                this.renderTree();
            }, SEARCH_DELAY);
        });
        this.refreshButton.addEventListener("click", () => this.refresh(this.selectedPath, true));
        this.tree.addEventListener("scroll", () => this.scheduleTreeWindowRender());
        this.tree.addEventListener("click", (event) => this.handleTreeClick(event));
        this.editor.addEventListener("input", () => this.updatePrompt(this.editor.value));
        this.nameInput.addEventListener("input", () => {
            this.persist();
            this.updateRenameButton();
        });
        this.categorySelect.addEventListener("change", () => this.persist());
        this.renameButton.addEventListener("click", () => this.rename());
        this.newButton.addEventListener("click", () => this.startNewPrompt());
        this.saveButton.addEventListener("click", () => this.save());
        this.status.addEventListener("click", (event) => {
            const button = event.target.closest("button[data-prompt-path]");
            if (button) this.openPromptFolder(button.dataset.promptPath);
        });
        root.addEventListener("pointerdown", (event) => event.stopPropagation());
        this.handleCanvasWheel = (event) => {
            event.stopPropagation();
            // Preserve native list scrolling without forwarding the wheel to the canvas.
            if (this.tree.contains(event.target)) return;
            event.preventDefault();
            app.canvas?.processMouseWheel?.(event);
        };
        root.addEventListener("wheel", this.handleCanvasWheel, { capture: true, passive: false });

        const domWidget = this.node.addDOMWidget("wzq_prompt_manager_panel", "div", root, {
            serialize: false,
            hideOnZoom: false,
            getMinHeight: () => PANEL_MIN_HEIGHT,
        });
        domWidget.options = domWidget.options || {};
        domWidget.options.serialize = false;
        domWidget.options.getMinHeight = () => PANEL_MIN_HEIGHT;

    }

    restore() {
        const promptWidget = findWidget(this.node, "prompt");
        this.editor.value = String(promptWidget?.value || "");
        let state = {};
        try { state = JSON.parse(this.node.properties?.wzq_prompt_manager_ui || "{}"); } catch {}
        this.selectedPath = typeof state.selectedPath === "string" ? state.selectedPath : "";
        this.nameInput.value = typeof state.name === "string" ? state.name : "";
        this.savedCategory = typeof state.category === "string" ? state.category : "";
        if (Array.isArray(state.expanded)) this.expanded = new Set(state.expanded.map(String));
        this.renderTree();
        this.updateRenameButton();
    }

    persist() {
        this.node.properties = this.node.properties || {};
        this.node.properties.wzq_prompt_manager_ui = JSON.stringify({
            selectedPath: this.selectedPath,
            name: this.nameInput.value,
            category: this.categorySelect.value || this.savedCategory || "",
            expanded: [...this.expanded],
        });
    }

    updatePrompt(value) {
        const promptWidget = findWidget(this.node, "prompt");
        if (promptWidget) {
            promptWidget.value = value;
            promptWidget.callback?.(value);
        }
        this.node.graph?.setDirtyCanvas(true, true);
    }

    setStatus(message = "", type = "", path = "") {
        const label = document.createElement("span");
        label.textContent = message;
        this.status.replaceChildren(label);
        if (path) {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "wzq-pm-status-path";
            button.dataset.promptPath = path;
            button.textContent = path;
            button.title = `打开所在文件夹：${path}`;
            this.status.append(button);
        }
        this.status.className = `wzq-pm-status${type ? ` ${type}` : ""}`;
    }

    async openPromptFolder(path) {
        try {
            const response = await api.fetchApi("/wzq/prompt-manager/open-folder", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ path }),
            });
            await jsonResponse(response);
        } catch (error) {
            this.setStatus(error.message, "error");
        }
    }

    async refresh(preferredPath = this.selectedPath, forceRefresh = false) {
        const serial = ++this.requestSerial;
        this.refreshButton.classList.add("loading");
        this.setStatus("正在读取 prompts 目录...");
        try {
            const categories = await getSharedLibrary(forceRefresh);
            if (serial !== this.requestSerial) return;
            this.categories = categories;
            this.populateCategories();
            this.selectedPath = preferredPath || "";
            this.renderTree();
            this.updateRenameButton();
            this.setStatus(this.categories.length ? "" : "prompts 目录下还没有分类文件夹");
        } catch (error) {
            if (serial === this.requestSerial) this.setStatus(error.message, "error");
        } finally {
            if (serial === this.requestSerial) this.refreshButton.classList.remove("loading");
        }
    }

    populateCategories() {
        const selected = this.savedCategory || this.categorySelect.value;
        this.categorySelect.replaceChildren();
        for (const category of this.categories) {
            const option = document.createElement("option");
            option.value = category.path;
            option.textContent = category.path || category.name;
            this.categorySelect.append(option);
        }
        if (this.categories.some((category) => category.path === selected)) {
            this.categorySelect.value = selected;
        }
        this.savedCategory = this.categorySelect.value;
    }

    renderTree() {
        if (!this.treeContent) return;
        const query = this.search.value.trim().toLocaleLowerCase();
        const rows = [];
        const children = new Map();
        for (const category of this.categories) {
            const parentPath = String(category.path || "").split("/").slice(0, -1).join("/");
            if (!children.has(parentPath)) children.set(parentPath, []);
            children.get(parentPath).push(category);
        }
        let visibleCount = 0;
        const appendCategory = (category) => {
            const prompts = Array.isArray(category.prompts) ? category.prompts : [];
            const categoryMatches = !query || category._search.includes(query);
            const visiblePrompts = query && !categoryMatches
                ? prompts.filter((prompt) => prompt._search.includes(query))
                : prompts;
            const isExpanded = Boolean(query) || this.expanded.has(category.path);
            if (categoryMatches || visiblePrompts.length) {
                visibleCount += 1;
                rows.push({ type: "folder", category, isExpanded });
            }

            if (!isExpanded) return;
            if (category.path) {
                for (const child of children.get(category.path) || []) appendCategory(child);
            }
            for (const prompt of visiblePrompts) {
                rows.push({ type: "prompt", category, prompt });
            }
        };
        for (const category of children.get("") || []) appendCategory(category);
        this.treeRows = rows;
        this.treeContent.style.height = visibleCount
            ? `${Math.max(1, rows.length * TREE_ROW_HEIGHT)}px`
            : "100%";
        if (!visibleCount) {
            const empty = document.createElement("div");
            empty.className = "wzq-pm-tree-empty";
            empty.textContent = query ? "没有匹配的提示词" : "暂无提示词分类";
            this.treeContent.replaceChildren(empty);
            this.treeWindowStart = -1;
            this.treeWindowEnd = -1;
            return;
        }
        this.renderTreeWindow(true);
        requestAnimationFrame(() => this.renderTreeWindow(true));
    }

    scheduleTreeWindowRender() {
        if (this.treeRenderFrame) return;
        this.treeRenderFrame = requestAnimationFrame(() => {
            this.treeRenderFrame = 0;
            this.renderTreeWindow();
        });
    }

    renderTreeWindow(force = false) {
        const rows = this.treeRows || [];
        const viewportHeight = this.tree.clientHeight || 300;
        const start = Math.max(0, Math.floor(this.tree.scrollTop / TREE_ROW_HEIGHT) - TREE_OVERSCAN);
        const end = Math.min(
            rows.length,
            Math.ceil((this.tree.scrollTop + viewportHeight) / TREE_ROW_HEIGHT) + TREE_OVERSCAN,
        );
        if (!force && start === this.treeWindowStart && end === this.treeWindowEnd) return;
        this.treeWindowStart = start;
        this.treeWindowEnd = end;

        const fragment = document.createDocumentFragment();
        for (let index = start; index < end; index += 1) {
            const row = rows[index];
            const button = document.createElement("button");
            button.type = "button";
            button.dataset.rowType = row.type;
            button.dataset.path = row.type === "folder" ? row.category.path : row.prompt.path;
            button.style.top = `${index * TREE_ROW_HEIGHT}px`;
            const depth = Math.max(0, Number(row.category.depth) || 0);

            if (row.type === "folder") {
                button.setAttribute("aria-expanded", String(row.isExpanded));
                button.className = `wzq-pm-folder${row.isExpanded ? " expanded" : ""}`;
                button.style.paddingLeft = `${5 + depth * 14}px`;
                button.innerHTML = `<span class="wzq-pm-chevron">${ICONS.chevron}</span><span class="wzq-pm-folder-icon">${ICONS.folder}</span><span class="wzq-pm-label"></span>`;
                button.querySelector(".wzq-pm-label").textContent = row.category.name;
                button.title = row.category.path || row.category.name;
            } else {
                button.className = `wzq-pm-item${row.prompt.path === this.selectedPath ? " active" : ""}`;
                button.style.paddingLeft = `${27 + depth * 14}px`;
                button.innerHTML = `<span class="wzq-pm-doc">${ICONS.document}</span><span class="wzq-pm-label"></span>`;
                button.querySelector(".wzq-pm-label").textContent = row.prompt.name;
                button.title = row.prompt.path;
            }
            fragment.append(button);
        }
        this.treeContent.replaceChildren(fragment);
    }

    handleTreeClick(event) {
        const button = event.target.closest("button[data-row-type]");
        if (!button || !this.treeContent.contains(button)) return;
        const path = button.dataset.path || "";
        if (button.dataset.rowType === "prompt") {
            this.loadPrompt(path);
            return;
        }
        if (this.expanded.has(path)) this.expanded.delete(path);
        else this.expanded.add(path);
        this.savedCategory = path;
        this.categorySelect.value = path;
        this.persist();
        this.renderTree();
    }

    updateActivePromptRow() {
        for (const item of this.treeContent.querySelectorAll(".wzq-pm-item")) {
            item.classList.toggle("active", item.dataset.path === this.selectedPath);
        }
    }

    selectedPromptName() {
        const filename = this.selectedPath.split("/").pop() || "";
        return filename.replace(/\.(txt|md|prompt)$/i, "");
    }

    updateRenameButton() {
        const name = this.nameInput.value.trim();
        this.renameButton.disabled = !this.selectedPath || !name || name === this.selectedPromptName();
    }

    startNewPrompt() {
        this.selectedPath = "";
        this.editor.value = "";
        this.nameInput.value = currentPromptName();
        this.updatePrompt("");
        this.persist();
        this.updateActivePromptRow();
        this.updateRenameButton();
        this.setStatus("已新建空白提示词");
        this.editor.focus();
    }

    async loadPrompt(path) {
        this.setStatus("正在读取...");
        try {
            const response = await api.fetchApi(`/wzq/prompt-manager/read?path=${encodeURIComponent(path)}`, { cache: "no-store" });
            const payload = await jsonResponse(response);
            this.selectedPath = payload.path;
            this.editor.value = payload.content || "";
            this.nameInput.value = payload.name || "";
            this.savedCategory = payload.category || "";
            if ([...this.categorySelect.options].some((option) => option.value === this.savedCategory)) {
                this.categorySelect.value = this.savedCategory;
            }
            this.updatePrompt(this.editor.value);
            this.persist();
            this.updateActivePromptRow();
            this.updateRenameButton();
            this.setStatus("已载入：", "success", payload.path);
        } catch (error) {
            this.setStatus(error.message, "error");
        }
    }

    async rename() {
        const name = this.nameInput.value.trim();
        if (!this.selectedPath) {
            this.setStatus("请先选择要改名的提示词", "error");
            return;
        }
        if (!name) {
            this.setStatus("请输入提示词名称", "error");
            this.nameInput.focus();
            return;
        }

        this.renameButton.disabled = true;
        this.setStatus("正在改名...");
        try {
            const response = await api.fetchApi("/wzq/prompt-manager/rename", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ path: this.selectedPath, name }),
            });
            const payload = await jsonResponse(response);
            this.selectedPath = payload.path;
            this.nameInput.value = payload.name;
            this.savedCategory = payload.category;
            invalidateSharedLibrary();
            await this.refresh(payload.path);
            this.persist();
            this.setStatus("已改名：", "success", payload.path);
        } catch (error) {
            this.setStatus(error.message, "error");
        } finally {
            this.updateRenameButton();
        }
    }

    async save(overwrite = false) {
        const name = this.nameInput.value.trim();
        const category = this.categorySelect.value;
        if (!name) {
            this.setStatus("请输入提示词名称", "error");
            this.nameInput.focus();
            return;
        }
        if (!this.categorySelect.options.length) {
            this.setStatus("请先在 prompts 目录中创建分类文件夹", "error");
            return;
        }

        this.saveButton.disabled = true;
        this.setStatus("正在保存...");
        try {
            const response = await api.fetchApi("/wzq/prompt-manager/save", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name, category, content: this.editor.value, overwrite }),
            });
            const payload = await jsonResponse(response);
            this.selectedPath = payload.path;
            this.nameInput.value = payload.name;
            this.savedCategory = payload.category;
            invalidateSharedLibrary();
            await this.refresh(payload.path);
            this.updateRenameButton();
            this.setStatus("已保存：", "success", payload.path);
        } catch (error) {
            if (error.status === 409 && !overwrite) {
                const confirmed = window.confirm("同名提示词已存在，是否覆盖？");
                this.saveButton.disabled = false;
                if (confirmed) return this.save(true);
                this.setStatus("已取消覆盖");
                return;
            }
            this.setStatus(error.message, "error");
        } finally {
            this.saveButton.disabled = false;
        }
    }

    destroy() {
        this.requestSerial += 1;
        clearTimeout(this.searchTimer);
        if (this.treeRenderFrame) cancelAnimationFrame(this.treeRenderFrame);
        this.root?.removeEventListener("wheel", this.handleCanvasWheel, { capture: true });
        this.root?.remove();
    }
}

function attachPanel(node) {
    if (node._wzqPromptManagerPanel || typeof node.addDOMWidget !== "function") return;
    hidePromptWidget(findWidget(node, "prompt"));
    node.setSize([Math.max(NODE_WIDTH, node.size?.[0] || 0), Math.max(NODE_HEIGHT, node.size?.[1] || 0)]);
    node.minWidth = NODE_WIDTH;
    node.minHeight = NODE_HEIGHT;
    node._wzqPromptManagerPanel = new PromptManagerPanel(node);
}

app.registerExtension({
    name: "wzq.prompt_manager",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== NODE_NAME) return;
        const originalCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const result = originalCreated?.apply(this, arguments);
            attachPanel(this);
            return result;
        };

        const originalConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function () {
            const result = originalConfigure?.apply(this, arguments);
            requestAnimationFrame(() => {
                hidePromptWidget(findWidget(this, "prompt"));
                this._wzqPromptManagerPanel?.restore();
                this._wzqPromptManagerPanel?.refresh();
            });
            return result;
        };

        const originalRemoved = nodeType.prototype.onRemoved;
        nodeType.prototype.onRemoved = function () {
            this._wzqPromptManagerPanel?.destroy();
            return originalRemoved?.apply(this, arguments);
        };
    },
    nodeCreated(node) {
        const nodeName = node?.comfyClass || node?.type;
        if (nodeName === NODE_NAME) attachPanel(node);
    },
});
