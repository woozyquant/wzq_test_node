import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const helper = (await readFile(new URL("../js/common/image_gallery.js", import.meta.url), "utf8"))
    .replace(/^import .*;\r?$/gm, "").replace("export function registerImageGallery", "function registerImageGallery");
const galleries = [
    { name: "pose", idField: "pose_id", nodeName: "wzq-pose-gallery", previewProperty: "_wzqPosePreview" },
    { name: "clothing", idField: "clothing_id", nodeName: "wzq-clothing-gallery", previewProperty: "_wzqClothingPreview" },
];
const origin = "http://localhost:8188";

async function environment(galleryConfig) {
    const source = helper + "\n" + (await readFile(new URL(`../js/${galleryConfig.name}_gallery.js`, import.meta.url), "utf8")).replace(/^import .*;\r?$/gm, "");
    class Target {
        constructor() { this.listeners = new Map(); }
        addEventListener(type, callback) {
            if (!this.listeners.has(type)) this.listeners.set(type, new Set());
            this.listeners.get(type).add(callback);
        }
        removeEventListener(type, callback) { this.listeners.get(type)?.delete(callback); }
        async emit(type, event) { await Promise.all([...this.listeners.get(type) || []].map(fn => fn(event))); }
    }
    class Element extends Target {
        constructor(tag) {
            super(); this.tag = tag; this.style = {}; this.children = []; this.open = false;
            this.messages = [];
            this.contentWindow = { postMessage: message => this.messages.push(message) };
        }
        setAttribute() {}
        append(...children) { this.children.push(...children); }
        showModal() { this.open = true; }
        close() { this.open = false; }
        remove() { this.removed = true; }
    }
    const window = new Target();
    const document = { createElement: tag => new Element(tag), body: new Element("body") };
    let extension;
    const app = { registerExtension: value => { extension = value; } };
    const api = {
        apiURL: url => url,
        async fetchApi(url) {
            const id = decodeURIComponent(url.split("/").at(-1));
            return { ok: true, json: async () => ({ id, 原图: `assets/img/${id}.png`, 姿势名称: id, 角度: "正面", category_zh: "春季", files: { original: `assets/original/${id}.png` }, width: 900, height: 1200 }) };
        },
    };
    vm.runInNewContext(source, {
        app, api, window, document, location: { origin }, URLSearchParams, queueMicrotask,
        crypto: { randomUUID: () => "test-session" },
        Image: class {
            set src(value) { this._src = value; queueMicrotask(() => this.onload?.()); }
            get src() { return this._src; }
        },
    });
    class Node {
        constructor() {
            this.widgets = [{ name: galleryConfig.idField, value: "pose-a" }];
            this.graph = { beforeChange() {}, afterChange() {}, change: () => { this.saved = this.widgets[0].value; } };
            this.onNodeCreated();
        }
        addWidget(type, name, value, callback, options) {
            const widget = { name, value, callback, ...options }; this.widgets.push(widget); return widget;
        }
        addDOMWidget() {}
        setSize() {}
        setDirtyCanvas() {}
    }
    await extension.beforeRegisterNodeDef(Node, { name: galleryConfig.nodeName });
    return { node: new Node(), window, document };
}

for (const galleryConfig of galleries) {
    test(`${galleryConfig.name}: reopens the same iframe without rebuilding the gallery`, async () => {
        const { node, window, document } = await environment(galleryConfig);
        const preview = node[galleryConfig.previewProperty];
        preview.open();
        const frame = preview.frame;
        const dialog = preview.dialog;
        const src = frame.src;
        dialog.close();
        node.widgets[0].value = "pose-b";
        preview.open();
        assert.equal(preview.dialog, dialog);
        assert.equal(preview.frame, frame);
        assert.equal(frame.src, src);
        assert.equal(document.body.children.length, 1);
        assert.equal(window.listeners.get("message").size, 1);
        assert.equal(frame.messages.at(-1)[galleryConfig.idField], "pose-b");
        assert.equal(dialog.open, true);
    });

    test(`${galleryConfig.name}: accepts selections only from the active gallery`, async () => {
        const { node, window } = await environment(galleryConfig);
        const preview = node[galleryConfig.previewProperty];
        preview.open();
        const message = { origin, source: preview.frame.contentWindow,
            data: { type: `${galleryConfig.nodeName}-select`, session: preview.session, [galleryConfig.idField]: "pose-b" } };
        await window.emit("message", { ...message, source: {} });
        assert.equal(node.widgets[0].value, "pose-a");
        preview.dialog.close();
        await window.emit("message", message);
        assert.equal(node.widgets[0].value, "pose-a");
        preview.open();
        await window.emit("message", message);
        assert.equal(node.widgets[0].value, "pose-b");
        assert.equal(node.saved, "pose-b");
        assert.equal(preview.dialog.open, false);
    });

    test(`${galleryConfig.name}: removing a node disposes its retained gallery`, async () => {
        const { node, window } = await environment(galleryConfig);
        const preview = node[galleryConfig.previewProperty];
        preview.open();
        const dialog = preview.dialog;
        node.onRemoved();
        assert.equal(dialog.open, false);
        assert.equal(dialog.removed, true);
        assert.equal(preview.dialog, null);
        assert.equal(preview.frame, null);
        assert.equal(window.listeners.get("message").size, 0);
    });
}
