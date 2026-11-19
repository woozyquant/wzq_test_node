import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = (await readFile(new URL("../js/common/prompt_manager_snippets.js", import.meta.url), "utf8"))
    .replace("export class PromptManagerSnippets", "class PromptManagerSnippets");
const storageKey = "WZQ.PromptManager.PromptSnippets";
const h3Key = "WZQ.MiniMaxH3.PromptSnippets";

function environment() {
    const storage = new Map();
    const window = new EventTarget();
    const document = { activeElement: null };
    class Element extends EventTarget {
        constructor() {
            super();
            this.value = ""; this.children = []; this.selectionStart = this.selectionEnd = 0;
            this.classList = { toggle() {} };
        }
        append(...children) {
            for (const child of children) { child.parentElement = this; this.children.push(child); }
        }
        replaceChildren(...children) { this.children = []; this.append(...children); }
        focus() { document.activeElement = this; }
        setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
        setRangeText(text, start, end) {
            this.value = this.value.slice(0, start) + text + this.value.slice(end);
            this.setSelectionRange(start + text.length, start + text.length);
        }
        remove() { this.removed = true; }
    }
    document.createElement = () => new Element();
    document.execCommand = (command, ui, text) => {
        const editor = document.activeElement;
        editor.setRangeText(text, editor.selectionStart, editor.selectionEnd);
        editor.dispatchEvent(new Event("input"));
        return true;
    };
    const context = vm.createContext({
        window, document, Event, AbortController,
        localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    });
    vm.runInContext(source + "\nglobalThis.helpers = { PromptManagerSnippets, activeSnippet, loadSnippets };", context);
    const create = () => {
        const root = new Element();
        const host = new Element();
        const editor = new Element();
        const button = new Element();
        root.append(host, button); host.append(editor);
        const controller = new context.helpers.PromptManagerSnippets(root, editor, button);
        return { controller, editor };
    };
    const type = (editor, value, position = value.length) => {
        editor.focus(); editor.value = value; editor.setSelectionRange(position, position);
        editor.dispatchEvent(new Event("input"));
    };
    const key = (editor, value, extra = {}) => {
        const event = new Event("keydown", { cancelable: true });
        Object.assign(event, { key: value, ...extra }); editor.dispatchEvent(event);
        return event;
    };
    return { ...context.helpers, storage, window, document, create, type, key };
}

test("only a complete name before the caret matches; punctuation and selections stop matching", () => {
    const { activeSnippet } = environment();
    for (const [value, start, end, expected] of [
        ["前文#画质", 5, 5, "画质"],
        ["#Style 后文", 6, 6, "Style"],
        ["#", 1, 1, null], ["#画质", 0, 0, null], ["#画质", 1, 3, null],
        ["#画质 ", 4, 4, null], ["#画质，", 4, 4, null], ["#画质。", 4, 4, null],
        ["#画质@图片", 6, 6, null], ["@画质", 3, 3, null],
    ]) {
        assert.equal(activeSnippet({ value, selectionStart: start, selectionEnd: end })?.query ?? null, expected, value);
    }
    assert.equal(activeSnippet({ value: "#画质", selectionStart: 3, selectionEnd: 3, readOnly: true }), null);
});

test("prompt manager loads its own library and ignores H3 changes", () => {
    const env = environment();
    const originalH3 = JSON.stringify([{ name: "画质", content: "H3 only" }]);
    env.storage.set(h3Key, originalH3);
    const { controller, editor } = env.create();
    env.type(editor, "#画质");
    assert.equal(controller.menu.hidden, true);
    env.storage.set(storageKey, JSON.stringify([{ name: "画质", content: "Manager only" }]));
    env.window.dispatchEvent(new Event("wzq-prompt-manager-snippets-changed"));
    assert.equal(controller.menu.hidden, false);
    assert.equal(controller.choices[0].content, "Manager only");
    env.storage.set(h3Key, "[]");
    const changed = new Event("storage"); Object.assign(changed, { key: h3Key });
    env.window.dispatchEvent(changed);
    assert.equal(controller.choices[0].content, "Manager only");
    controller.destroy();
});

test("Enter, Tab and clicking insert multiline text at the caret and synchronize the output once", () => {
    for (const action of ["Enter", "Tab", "click"]) {
        const env = environment();
        env.storage.set(storageKey, JSON.stringify([{ name: "Style", content: "高清\n细节 <tag>" }]));
        const { controller, editor } = env.create();
        env.type(editor, "前文#sTyLe后文", 8);
        assert.equal(controller.menu.hidden, false);
        let output;
        let updates = 0;
        editor.addEventListener("input", () => { output = editor.value; updates++; });
        if (action === "click") controller.menu.children[0].dispatchEvent(new Event("click"));
        else assert.equal(env.key(editor, action).defaultPrevented, true);
        assert.equal(editor.value, "前文高清\n细节 <tag>后文");
        assert.equal(output, editor.value);
        assert.equal(updates, 1);
        assert.equal(editor.selectionStart, "前文高清\n细节 <tag>".length);
        assert.equal(controller.menu.hidden, true);
        controller.destroy();
    }
});

test("partial names and unknown names stay plain text; Escape dismisses the candidate", () => {
    const env = environment();
    env.storage.set(storageKey, JSON.stringify([{ name: "Style", content: "expanded" }]));
    const { controller, editor } = env.create();
    for (const value of ["#Sty", "#Unknown", "#Style ", "#Style，"]) {
        env.type(editor, value);
        assert.equal(controller.menu.hidden, true, value);
        assert.equal(env.key(editor, "Enter").defaultPrevented, false);
        assert.equal(editor.value, value);
    }
    env.type(editor, "#Style");
    env.key(editor, "Escape");
    assert.equal(controller.menu.hidden, true);
    assert.equal(editor.value, "#Style");
    controller.destroy();
});

test("IME confirmation doesn't insert a snippet; Enter after composition does", () => {
    const env = environment();
    env.storage.set(storageKey, JSON.stringify([{ name: "画质", content: "高清" }]));
    const { controller, editor } = env.create();
    editor.dispatchEvent(new Event("compositionstart"));
    env.type(editor, "#画质");
    assert.equal(controller.menu.hidden, true);
    assert.equal(env.key(editor, "Enter", { isComposing: true }).defaultPrevented, false);
    editor.dispatchEvent(new Event("compositionend"));
    assert.equal(controller.menu.hidden, false);
    assert.equal(env.key(editor, "Enter", { keyCode: 229 }).defaultPrevented, false);
    env.key(editor, "Enter");
    assert.equal(editor.value, "高清");
    controller.destroy();
});

test("fallback insertion, storage clearing, reload and destroyed listeners", () => {
    const env = environment();
    env.storage.set(storageKey, JSON.stringify([{ name: "空", content: "" }]));
    const { controller, editor } = env.create();
    env.document.execCommand = () => false;
    env.type(editor, "前#空后", 3);
    env.key(editor, "Tab");
    assert.equal(editor.value, "前后");
    const restored = env.create();
    env.type(restored.editor, "#空");
    assert.equal(restored.controller.menu.hidden, false);
    env.storage.delete(storageKey);
    const clear = new Event("storage"); Object.assign(clear, { key: null });
    env.window.dispatchEvent(clear);
    assert.equal(restored.controller.menu.hidden, true);
    restored.controller.destroy(); controller.destroy();
    env.storage.set(storageKey, JSON.stringify([{ name: "空", content: "new" }]));
    env.window.dispatchEvent(new Event("wzq-prompt-manager-snippets-changed"));
    assert.equal(controller.snippets.length, 0);
});
