import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";

const NODE_NAME = "WZQFolderShortcuts";
const PROPERTY = "wzq_folder_shortcuts";
const FOLDER_ICON = `<svg viewBox="0 0 20 18" aria-hidden="true"><path d="M2 4V3a1 1 0 0 1 1-1h5l2 2h7a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1Z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>`;

async function requestJson(url, options) {
    const response = await api.fetchApi(url, options);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || `请求失败 (${response.status})`);
    return payload;
}

function button(label, className = "") {
    const element = document.createElement("button");
    element.type = "button";
    element.textContent = label;
    element.className = className;
    return element;
}

function installStyle() {
    if (document.getElementById("wzq-folder-shortcuts-style")) return;
    const style = document.createElement("link");
    style.id = "wzq-folder-shortcuts-style";
    style.rel = "stylesheet";
    style.href = new URL("./folder_shortcuts.css", import.meta.url).href;
    document.head.append(style);
}

class FolderShortcutsPanel {
    constructor(node) {
        this.node = node;
        this.items = [];
        this.destroyed = false;
        this.root = document.createElement("div");
        this.root.className = "wzq-folder-shortcuts";
        this.root.innerHTML = `
            <div class="wzq-fs-caption"><span>常用文件夹</span><span class="wzq-fs-count"></span></div>
            <div class="wzq-fs-grid"></div>
            <button type="button" class="wzq-fs-manage" aria-expanded="false">⚙ 管理路径</button>
            <form class="wzq-fs-editor" hidden>
                <div class="wzq-fs-fields"></div>
                <div class="wzq-fs-actions">
                    <button type="button" class="wzq-fs-add">＋ 添加路径</button>
                    <span class="wzq-fs-save-actions"><button type="button" class="wzq-fs-cancel">取消</button><button type="submit" class="wzq-fs-save">保存</button></span>
                </div>
            </form>
            <div class="wzq-fs-status" role="status" aria-live="polite">正在读取默认路径…</div>`;
        this.grid = this.root.querySelector(".wzq-fs-grid");
        this.editor = this.root.querySelector(".wzq-fs-editor");
        this.fields = this.root.querySelector(".wzq-fs-fields");
        this.manage = this.root.querySelector(".wzq-fs-manage");
        this.status = this.root.querySelector(".wzq-fs-status");
        this.domWidget = node.addDOMWidget("wzq_folder_shortcuts_panel", "div", this.root, {
            serialize: false,
            hideOnZoom: false,
            getMinHeight: () => this.panelHeight || 260,
        });
        this.manage.onclick = () => this.toggleEditor();
        this.root.querySelector(".wzq-fs-add").onclick = () => {
            this.addRow();
            this.updateSize();
            this.fields.lastElementChild.querySelector("input").focus();
        };
        this.root.querySelector(".wzq-fs-cancel").onclick = () => this.closeEditor();
        this.editor.onsubmit = (event) => { event.preventDefault(); this.save(); };
        for (const type of ["pointerdown", "mousedown", "dblclick", "keydown"]) {
            this.root.addEventListener(type, (event) => event.stopPropagation());
        }
        this.handleCanvasWheel = (event) => {
            event.preventDefault();
            event.stopPropagation();
            app.canvas?.processMouseWheel?.(event);
        };
        this.root.addEventListener("wheel", this.handleCanvasWheel, { capture: true, passive: false });
        this.restore();
        this.loadDefaults();
    }

    restore() {
        const saved = this.node.properties?.[PROPERTY];
        if (!Array.isArray(saved)) return;
        this.items = saved.filter(item => item && typeof item.name === "string" && typeof item.path === "string")
            .map(item => ({ name: item.name, path: item.path }));
        this.closeEditor();
        this.render();
        this.setStatus("就绪");
    }

    async loadDefaults() {
        if (Array.isArray(this.node.properties?.[PROPERTY])) return;
        try {
            const payload = await requestJson("/wzq/folder-shortcuts/defaults");
            // A workflow may finish configuring while the request is in flight.
            if (this.destroyed || Array.isArray(this.node.properties?.[PROPERTY])) return;
            this.items = payload.items;
            this.persist();
            this.render();
            this.setStatus("就绪");
        } catch (error) {
            if (!this.destroyed && !Array.isArray(this.node.properties?.[PROPERTY])) this.setStatus(error.message, true);
        }
    }

    persist() {
        this.node.properties = this.node.properties || {};
        this.node.properties[PROPERTY] = this.items.map(item => ({ ...item }));
        this.node.graph?.setDirtyCanvas(true, true);
    }

    render() {
        this.grid.replaceChildren();
        this.root.querySelector(".wzq-fs-count").textContent = `${this.items.length} 个路径`;
        for (const item of this.items) {
            const open = button("", "wzq-fs-open");
            open.innerHTML = FOLDER_ICON;
            const label = document.createElement("span");
            label.textContent = item.name;
            open.append(label);
            open.title = `${item.name}\n${item.path}`;
            open.setAttribute("aria-label", `打开 ${item.name}：${item.path}`);
            open.onclick = () => this.open(item, open);
            this.grid.append(open);
        }
        if (!this.items.length) {
            const empty = document.createElement("div");
            empty.className = "wzq-fs-empty";
            empty.textContent = "点击管理路径，添加文件夹按钮";
            this.grid.append(empty);
        }
        this.updateSize();
    }

    async open(item, trigger) {
        trigger.disabled = true;
        this.setStatus(`正在打开：${item.name}`);
        try {
            const payload = await requestJson("/wzq/folder-shortcuts/open", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ path: item.path }),
            });
            if (!this.destroyed) this.setStatus(`已打开：${payload.path}`);
        } catch (error) {
            if (!this.destroyed) this.setStatus(error.message, true);
        } finally {
            trigger.disabled = false;
        }
    }

    toggleEditor() {
        if (!this.editor.hidden) { this.closeEditor(); return; }
        this.fields.replaceChildren();
        this.items.forEach(item => this.addRow(item));
        if (!this.items.length) this.addRow();
        this.editor.hidden = false;
        this.manage.setAttribute("aria-expanded", "true");
        this.updateSize();
    }

    closeEditor() {
        this.editor.hidden = true;
        this.manage.setAttribute("aria-expanded", "false");
        this.updateSize();
    }

    addRow(item = { name: "", path: "" }) {
        const row = document.createElement("div");
        row.className = "wzq-fs-row";
        const head = document.createElement("div");
        head.className = "wzq-fs-row-head";
        const nameLabel = document.createElement("label");
        nameLabel.textContent = "按钮名称";
        const name = document.createElement("input");
        name.value = item.name;
        name.placeholder = "例如：我的素材库";
        name.required = true;
        nameLabel.append(name);
        const remove = button("删除", "wzq-fs-delete");
        remove.setAttribute("aria-label", "删除此路径");
        remove.onclick = () => { row.remove(); this.updateSize(); };
        head.append(nameLabel, remove);
        const pathLabel = document.createElement("label");
        pathLabel.textContent = "文件夹路径";
        const path = document.createElement("input");
        path.value = item.path;
        path.placeholder = "文件夹的绝对路径";
        path.required = true;
        path.spellcheck = false;
        pathLabel.append(path);
        row.append(head, pathLabel);
        this.fields.append(row);
    }

    save() {
        const items = Array.from(this.fields.children).map(row => {
            const inputs = row.querySelectorAll("input");
            return { name: inputs[0].value.trim(), path: inputs[1].value.trim() };
        });
        if (items.some(item => !item.name || !item.path)) {
            this.setStatus("请填写按钮名称和文件夹路径。", true);
            return;
        }
        this.items = items;
        this.persist();
        this.closeEditor();
        this.render();
        this.setStatus("已保存；保存工作流可保留此配置");
    }

    setStatus(message, error = false) {
        this.status.textContent = message;
        this.status.classList.toggle("error", error);
        this.status.setAttribute("role", error ? "alert" : "status");
    }

    updateSize() {
        const gridHeight = Math.max(1, Math.ceil(this.items.length / 2)) * 92;
        const editorHeight = this.editor.hidden ? 0 : this.fields.children.length * 133 + 58;
        this.panelHeight = gridHeight + editorHeight + 140;
        this.node.minWidth = 360;
        this.node.minHeight = this.panelHeight + 40;
        this.node.setSize([Math.max(360, this.node.size[0]), this.node.minHeight]);
        this.node.graph?.setDirtyCanvas(true, true);
    }

    destroy() {
        this.destroyed = true;
        this.root.removeEventListener("wheel", this.handleCanvasWheel, { capture: true });
        this.root.remove();
    }
}

function attachPanel(node) {
    if (node._wzqFolderShortcutsPanel) return;
    installStyle();
    node._wzqFolderShortcutsPanel = new FolderShortcutsPanel(node);
}

app.registerExtension({
    name: "wzq.folder_shortcuts",
    beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== NODE_NAME) return;
        const created = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const result = created?.apply(this, arguments);
            attachPanel(this);
            return result;
        };
        const configure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function () {
            const result = configure?.apply(this, arguments);
            this._wzqFolderShortcutsPanel?.restore();
            return result;
        };
        const removed = nodeType.prototype.onRemoved;
        nodeType.prototype.onRemoved = function () {
            this._wzqFolderShortcutsPanel?.destroy();
            return removed?.apply(this, arguments);
        };
    },
    nodeCreated(node) {
        if ((node.comfyClass || node.type) === NODE_NAME) attachPanel(node);
    },
});
