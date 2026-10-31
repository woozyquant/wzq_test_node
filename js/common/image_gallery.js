import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";

function openGallery(node, input, preview) {
    const config = preview.config;
    const session = crypto.randomUUID();
    const dialog = document.createElement("dialog");
    dialog.setAttribute("aria-label", `选择${config.subject}`);
    dialog.style.cssText = "padding:0;border:1px solid #555;border-radius:14px;width:96vw;height:94vh;max-width:1700px;max-height:96vh;overflow:hidden;background:#f5f7fb;";
    const bar = document.createElement("div");
    bar.style.cssText = "height:38px;padding:0 14px;display:flex;align-items:center;justify-content:space-between;background:#252730;color:#eee;font:13px sans-serif;";
    const label = document.createElement("span");
    label.textContent = `${config.subject}图库 · 选择后点击「使用此${config.subject}」`;
    const close = document.createElement("button");
    close.textContent = "关闭 ✕";
    close.style.cssText = "cursor:pointer;background:transparent;color:#eee;border:0;padding:8px;";
    const frame = document.createElement("iframe");
    frame.title = `${config.nodeName} ${config.subject}选择`;
    frame.style.cssText = "display:block;width:100%;height:calc(100% - 38px);border:0;";
    frame.src = api.apiURL(`${config.base}?${new URLSearchParams({ session, [config.idField]: input.value || "" })}`);
    const receive = async (event) => {
        if (!dialog.open || event.origin !== location.origin || event.source !== frame.contentWindow || event.data?.session !== session) return;
        if (event.data.type === `${config.nodeName}-close`) dialog.close();
        if (event.data.type !== `${config.nodeName}-select` || typeof event.data[config.idField] !== "string") return;
        try {
            const row = await requestItem(config, event.data[config.idField]);
            if (!dialog.open || node[config.previewProperty] !== preview) return;
            node.graph?.beforeChange();
            input.value = row.id;
            input.callback?.(input.value);
            node.graph?.afterChange();
            node.graph?.change();
            node.setDirtyCanvas(true, true);
            dialog.close();
        } catch (error) {
            label.textContent = error.message;
        }
    };
    window.addEventListener("message", receive);
    close.onclick = () => dialog.close();
    dialog.addEventListener("click", event => { if (event.target === dialog) dialog.close(); });
    bar.append(label, close);
    dialog.append(bar, frame);
    document.body.append(dialog);
    preview.dialog = dialog;
    preview.frame = frame;
    preview.receive = receive;
    preview.session = session;
    frame.onload = () => preview.selectCurrent();
    dialog.showModal();
}

async function requestItem(config, id) {
    const response = await api.fetchApi(`${config.base}${config.itemRoute}/${encodeURIComponent(id || "")}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `${config.subject}读取失败 (${response.status})`);
    return data;
}

class ImageGalleryPreview {
    constructor(node, input, config) {
        this.config = config;
        this.node = node;
        this.input = input;
        this.serial = 0;
        this.dialog = null;
        this.root = document.createElement("div");
        this.root.style.cssText = "width:100%;height:100%;min-height:220px;display:flex;flex-direction:column;gap:6px;overflow:hidden;";
        this.image = document.createElement("img");
        this.image.draggable = false;
        this.image.alt = `所选${config.subject}原图`;
        this.image.style.cssText = "display:none;width:100%;flex:1;min-height:0;object-fit:contain;background:#faf9f6;border-radius:10px;cursor:zoom-in;";
        this.status = document.createElement("div");
        this.status.style.cssText = "font:12px/1.5 sans-serif;color:#bbb;white-space:normal;overflow-wrap:anywhere;flex-shrink:0;";
        this.status.setAttribute("role", "status");
        this.root.append(this.image, this.status);
        node.addDOMWidget(config.widgetName, "div", this.root, { serialize: false, getMinHeight: () => 260 });
        this.image.onclick = () => this.open();
        this.refresh();
    }

    open() {
        if (!this.dialog) {
            openGallery(this.node, this.input, this);
        } else if (!this.dialog.open) {
            this.dialog.showModal();
            this.selectCurrent();
        }
    }

    selectCurrent() {
        this.frame.contentWindow?.postMessage({
            type: `${this.config.nodeName}-open`, session: this.session, [this.config.idField]: this.input.value,
        }, location.origin);
    }

    async refresh() {
        const serial = ++this.serial;
        const id = this.input.value;
        this.image.style.display = "none";
        this.status.textContent = `正在加载${this.config.subject}…`;
        try {
            const row = await requestItem(this.config, id);
            if (serial !== this.serial) return;
            const loaded = new Image();
            loaded.onload = () => {
                if (serial !== this.serial) return;
                this.image.src = loaded.src;
                this.image.style.display = "block";
                this.status.textContent = `${this.config.caption(row)} · ${row.width} × ${row.height}`;
                this.node.setDirtyCanvas(true);
            };
            loaded.onerror = () => {
                if (serial === this.serial) this.status.textContent = `${this.config.subject}原图加载失败：${id}。`;
            };
            loaded.src = api.apiURL(this.config.base + this.config.image(row));
        } catch (error) {
            if (serial === this.serial) this.status.textContent = error.message;
        }
    }

    destroy() {
        this.serial++;
        if (this.dialog) {
            window.removeEventListener("message", this.receive);
            this.frame.onload = null;
            this.dialog.close();
            this.dialog.remove();
            this.dialog = null;
            this.frame = null;
            this.receive = null;
        }
        this.image.onclick = null;
    }
}

export function registerImageGallery(config) {
    app.registerExtension({
        name: config.extensionName,
        async beforeRegisterNodeDef(nodeType, nodeData) {
            if (nodeData.name !== config.nodeName) return;
            const created = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function () {
                const result = created?.apply(this, arguments);
                const input = this.widgets.find(widget => widget.name === config.idField);
                const browse = this.addWidget("button", config.browseLabel, null,
                    () => this[config.previewProperty].open(), { serialize: false });
                browse.serialize = false;
                this[config.previewProperty] = new ImageGalleryPreview(this, input, config);
                const nodePreview = this[config.previewProperty];
                const callback = input.callback;
                input.callback = function () {
                    const result = callback?.apply(this, arguments);
                    nodePreview.refresh();
                    return result;
                };
                this.setSize([420, 570]);
                return result;
            };
            const configured = nodeType.prototype.onConfigure;
            nodeType.prototype.onConfigure = function () {
                const result = configured?.apply(this, arguments);
                queueMicrotask(() => this[config.previewProperty]?.refresh());
                return result;
            };
            const removed = nodeType.prototype.onRemoved;
            nodeType.prototype.onRemoved = function () {
                this[config.previewProperty]?.destroy();
                return removed?.apply(this, arguments);
            };
        },
    });
}
