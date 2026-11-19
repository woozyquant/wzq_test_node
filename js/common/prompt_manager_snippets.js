const STORAGE_KEY = "WZQ.PromptManager.PromptSnippets";
const CHANGED_EVENT = "wzq-prompt-manager-snippets-changed";
const TERMINATOR = /[\s@#,.，。“”"'‘’、;；:：!?！？()（）[\]{}【】《》<>]/u;
const NAME_ORDER = new Intl.Collator("zh-CN", { sensitivity: "base", numeric: true });

function loadSnippets() {
    try {
        const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
        return Array.isArray(value) ? value
            .filter(item => item && typeof item.name === "string" && typeof item.content === "string")
            .map(item => ({ name: item.name.trim(), content: item.content })) : [];
    } catch { return []; }
}

function activeSnippet(editor) {
    const { value, selectionStart: start, selectionEnd: end } = editor;
    if (editor.readOnly || editor.disabled || start !== end || !end) return null;
    const hash = value.lastIndexOf("#", end - 1);
    if (hash < 0) return null;
    const query = value.slice(hash + 1, end);
    if (!query || TERMINATOR.test(query)) return null;
    return { start: hash, end, query };
}

const STYLES = `
    .wzq-pm-editor-host{position:relative}
    .wzq-pm-snippet-tool{display:inline-flex;align-items:center;justify-content:center;flex:0 0 22px;width:22px;height:22px;margin-left:6px;padding:0;border:0;border-radius:4px;background:transparent;color:#9ba8b3;opacity:.72;cursor:pointer}.wzq-pm-snippet-tool svg{display:block;width:13px;height:13px}.wzq-pm-snippet-tool:hover{background:#ffffff0a;color:#e1e8ef;opacity:1}.wzq-pm-snippet-tool:focus-visible{outline:1px solid #4c91c5;outline-offset:1px;opacity:1}
    .wzq-pm-snippet-menu{position:absolute;z-index:10;top:30px;left:6px;right:6px;max-height:min(180px,calc(100% - 36px));overflow:auto;padding:4px;border:1px solid #414e59;border-radius:5px;background:#20272e;box-shadow:0 6px 16px #0006;scrollbar-width:thin}
    .wzq-pm-snippet-option{display:flex;align-items:center;gap:8px;width:100%;padding:6px;border:0;border-radius:3px;background:transparent;color:#dde5ec;text-align:left;cursor:pointer;font:12px/1.4 Arial,"Microsoft YaHei",sans-serif}.wzq-pm-snippet-option:hover,.wzq-pm-snippet-option.active{background:#28506a}.wzq-pm-snippet-option span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.wzq-pm-snippet-option span:last-child{flex:1;color:#96a6b3}
    .wzq-pm-snippets-dialog{position:fixed;box-sizing:border-box;width:min(740px,calc(100vw - 32px));height:min(500px,calc(100vh - 40px));max-width:none;max-height:none;margin:auto;padding:16px;border:1px solid #46525c;border-radius:9px;background:#20252b;color:#dde3e8;box-shadow:0 12px 40px #0008;font:12px/1.4 Arial,"Microsoft YaHei",sans-serif}.wzq-pm-snippets-dialog::backdrop{background:#0009}.wzq-pm-snippets-dialog *{box-sizing:border-box}.wzq-pm-snippets-dialog button,.wzq-pm-snippets-dialog input,.wzq-pm-snippets-dialog textarea{font:inherit}
    .wzq-pm-snippets-layout{display:flex;flex-direction:column;height:100%;gap:12px}.wzq-pm-snippets-title{font-size:14px;font-weight:600}.wzq-pm-snippets-hint{color:#8e9da9;font-size:11px;margin-top:3px}.wzq-pm-snippets-body{display:grid;grid-template-columns:minmax(120px,30%) minmax(0,1fr);gap:12px;flex:1;min-height:0}.wzq-pm-snippets-sidebar,.wzq-pm-snippets-editor{display:flex;flex-direction:column;gap:7px;min-width:0;min-height:0}
    .wzq-pm-snippets-list{flex:1;min-height:0;overflow:auto;padding:4px;border:1px solid #414b55;border-radius:5px;background:#181c21;scrollbar-width:thin}.wzq-pm-snippets-list button{display:block;width:100%;padding:7px;border:0;border-radius:3px;background:transparent;color:#ccd6dd;text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer}.wzq-pm-snippets-list button:hover,.wzq-pm-snippets-list button.active{background:#28506a;color:#fff}.wzq-pm-snippets-empty{padding:12px 6px;color:#8e9da9;text-align:center}
    .wzq-pm-snippets-sidebar-actions{display:flex;gap:6px}.wzq-pm-snippets-sidebar-actions button{flex:1}.wzq-pm-snippets-dialog button{cursor:pointer}.wzq-pm-snippets-dialog button:disabled{opacity:.4;cursor:default}.wzq-pm-snippets-sidebar-actions button,.wzq-pm-snippets-actions button{padding:6px 10px;border:1px solid #46525c;border-radius:4px;background:#2b343c;color:#dde3e8}.wzq-pm-snippets-actions button:last-child{background:#225b7a;border-color:#347698}
    .wzq-pm-snippets-editor label{display:flex;flex-direction:column;gap:5px;color:#a9b8c3}.wzq-pm-snippets-editor input,.wzq-pm-snippets-editor textarea{width:100%;min-width:0;padding:8px;border:1px solid #46525c;border-radius:4px;background:#181c21;color:#e3eaf0;outline:none}.wzq-pm-snippets-editor input:focus,.wzq-pm-snippets-editor textarea:focus{border-color:#3389c9}.wzq-pm-snippets-content{flex:1;min-height:0}.wzq-pm-snippets-content textarea{flex:1;min-height:0;resize:none}.wzq-pm-snippets-validation{min-height:17px;color:#d69b63;overflow-wrap:anywhere}.wzq-pm-snippets-validation.error{color:#e37d85}.wzq-pm-snippets-actions{display:flex;justify-content:flex-end;gap:7px}
`;

export class PromptManagerSnippets {
    constructor(root, editor, button) {
        this.editor = editor;
        this.button = button;
        this.snippets = loadSnippets();
        this.choices = [];
        this.index = 0;
        this.composing = false;
        this.events = new AbortController();
        const style = document.createElement("style");
        style.textContent = STYLES;
        root.append(style);
        this.menu = document.createElement("div");
        this.menu.className = "wzq-pm-snippet-menu";
        this.menu.hidden = true;
        editor.parentElement.append(this.menu);
        const listen = (target, type, handler) => target.addEventListener(type, handler, { signal: this.events.signal });
        listen(button, "click", () => this.openSettings());
        listen(editor, "input", () => { this.index = 0; this.updateMenu(); });
        listen(editor, "click", () => this.updateMenu());
        listen(editor, "select", () => this.updateMenu());
        listen(editor, "keyup", event => {
            if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) this.updateMenu();
        });
        listen(editor, "blur", () => this.closeMenu());
        listen(editor, "compositionstart", () => { this.composing = true; this.closeMenu(); });
        listen(editor, "compositionend", () => { this.composing = false; this.updateMenu(); });
        listen(editor, "keydown", event => {
            if (this.composing || event.isComposing || event.keyCode === 229 || this.menu.hidden) return;
            if (event.key === "Escape") {
                event.preventDefault(); event.stopPropagation(); this.closeMenu();
            } else if (["ArrowDown", "ArrowUp"].includes(event.key)) {
                event.preventDefault(); event.stopPropagation();
                this.index = (this.index + (event.key === "ArrowDown" ? 1 : -1) + this.choices.length) % this.choices.length;
                this.updateMenu();
            } else if (["Enter", "Tab"].includes(event.key)) {
                event.preventDefault(); event.stopPropagation(); this.insert(this.choices[this.index]);
            }
        });
        listen(window, "storage", event => {
            if (event.key === STORAGE_KEY || event.key === null) this.refresh();
        });
        listen(window, CHANGED_EVENT, () => this.refresh());
    }

    refresh() {
        this.snippets = loadSnippets();
        this.updateMenu();
    }

    closeMenu() {
        this.menu.hidden = true;
        this.menu.replaceChildren();
        this.choices = [];
    }

    updateMenu() {
        const active = activeSnippet(this.editor);
        if (this.inserting || this.composing || document.activeElement !== this.editor || !active) {
            this.closeMenu();
            return;
        }
        const query = active.query.toLocaleLowerCase();
        this.choices = this.snippets.filter(snippet => snippet.name.toLocaleLowerCase() === query);
        if (!this.choices.length) { this.closeMenu(); return; }
        this.index = Math.min(this.index, this.choices.length - 1);
        this.menu.replaceChildren();
        this.choices.forEach((snippet, index) => {
            const option = document.createElement("button");
            option.type = "button";
            option.className = `wzq-pm-snippet-option${index === this.index ? " active" : ""}`;
            const name = document.createElement("span");
            name.textContent = `#${snippet.name}`;
            const preview = document.createElement("span");
            preview.textContent = snippet.content.replace(/\s+/g, " ").trim();
            option.append(name, preview);
            option.addEventListener("pointerdown", event => { event.preventDefault(); event.stopPropagation(); });
            option.addEventListener("click", event => { event.stopPropagation(); this.insert(snippet); });
            this.menu.append(option);
        });
        this.menu.hidden = false;
    }

    insert(snippet) {
        const active = activeSnippet(this.editor);
        if (!snippet || !active || active.query.toLocaleLowerCase() !== snippet.name.toLocaleLowerCase()) {
            this.closeMenu();
            return;
        }
        this.inserting = true;
        this.editor.focus();
        this.editor.setSelectionRange(active.start, active.end);
        // Native insertion keeps the expansion in the textarea's undo history.
        if (!document.execCommand("insertText", false, snippet.content)) {
            this.editor.setRangeText(snippet.content, active.start, active.end, "end");
            this.editor.dispatchEvent(new Event("input", { bubbles: true }));
        }
        this.inserting = false;
        this.closeMenu();
    }

    openSettings() {
        this.closeSettings?.();
        this.closeMenu();
        const draft = loadSnippets();
        let selected = draft.length ? 0 : -1;
        let saved = JSON.stringify(draft);
        const dialog = document.createElement("dialog");
        dialog.className = "wzq-pm-snippets-dialog";
        dialog.setAttribute("aria-label", "提示词管理器片段库");
        dialog.innerHTML = `
          <div class="wzq-pm-snippets-layout">
            <div><div class="wzq-pm-snippets-title">提示词管理器 · 片段库</div>
              <div class="wzq-pm-snippets-hint">独立保存在当前浏览器中。输入完整的 #片段名，按 Enter / Tab 或点击候选插入。</div></div>
            <div class="wzq-pm-snippets-body">
              <div class="wzq-pm-snippets-sidebar">
                <div class="wzq-pm-snippets-list"></div>
                <div class="wzq-pm-snippets-sidebar-actions"><button type="button" data-action="add">＋ 新增</button><button type="button" data-action="remove">－ 删除</button></div>
              </div>
              <div class="wzq-pm-snippets-editor">
                <label>片段名称<input type="text" autocomplete="off" placeholder="例如：画质"></label>
                <label class="wzq-pm-snippets-content">片段内容<textarea spellcheck="false" placeholder="在这里输入要插入的文本..."></textarea></label>
                <div class="wzq-pm-snippets-validation" role="status"></div>
              </div>
            </div>
            <div class="wzq-pm-snippets-actions"><button type="button" data-action="cancel">取消</button><button type="button" data-action="save">保存</button><button type="button" data-action="done">保存并关闭</button></div>
          </div>`;
        const list = dialog.querySelector(".wzq-pm-snippets-list");
        const name = dialog.querySelector("input");
        const content = dialog.querySelector("textarea");
        const validation = dialog.querySelector(".wzq-pm-snippets-validation");
        const action = key => dialog.querySelector(`[data-action="${key}"]`);
        const validate = () => {
            const names = draft.map(snippet => snippet.name.trim().toLocaleLowerCase());
            let message = "";
            if (names.some(value => !value)) message = "片段名称不能为空";
            else if (draft.some(snippet => TERMINATOR.test(snippet.name.trim()))) message = "片段名称不能包含空格、@、# 或中英文标点";
            else if (new Set(names).size !== names.length) message = "片段名称不能重复（不区分大小写）";
            validation.classList.toggle("error", !!message);
            validation.textContent = message || (JSON.stringify(draft) !== saved ? "有未保存的修改" : "");
            action("save").disabled = !!message || JSON.stringify(draft) === saved;
            action("done").disabled = !!message;
            return !message;
        };
        const renderList = () => {
            list.replaceChildren();
            if (!draft.length) {
                const empty = document.createElement("div");
                empty.className = "wzq-pm-snippets-empty"; empty.textContent = "暂无片段，点击新增";
                list.append(empty);
            }
            const ordered = draft.map((snippet, index) => ({ snippet, index }))
                .sort((a, b) => NAME_ORDER.compare(a.snippet.name.trim(), b.snippet.name.trim()));
            ordered.forEach(({ snippet, index }) => {
                const item = document.createElement("button");
                item.type = "button"; item.textContent = snippet.name || "未命名片段";
                item.classList.toggle("active", index === selected);
                item.onclick = () => { selected = index; renderList(); renderEditor(); };
                list.append(item);
            });
            action("remove").disabled = selected < 0;
        };
        const renderEditor = () => {
            name.disabled = content.disabled = selected < 0;
            name.value = draft[selected]?.name || "";
            content.value = draft[selected]?.content || "";
            validate();
        };
        name.addEventListener("input", () => {
            if (selected < 0) return;
            draft[selected].name = name.value; renderList(); validate();
        });
        content.addEventListener("input", () => {
            if (selected < 0) return;
            draft[selected].content = content.value; validate();
        });
        action("add").onclick = () => {
            const names = new Set(draft.map(snippet => snippet.name.trim().toLocaleLowerCase()));
            let index = 1;
            while (names.has(`新建片段${index}`)) index++;
            draft.push({ name: `新建片段${index}`, content: "" });
            selected = draft.length - 1; renderList(); renderEditor(); name.focus(); name.select();
        };
        action("remove").onclick = () => {
            if (selected < 0) return;
            draft.splice(selected, 1); selected = Math.min(selected, draft.length - 1);
            renderList(); renderEditor();
        };
        const close = () => {
            dialog.close(); dialog.remove(); this.closeSettings = null; this.button.focus();
        };
        const save = closeAfter => {
            if (!validate()) return;
            for (const snippet of draft) snippet.name = snippet.name.trim();
            try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
            } catch (error) {
                validation.classList.add("error");
                validation.textContent = `无法保存片段：${error.message}`;
                return;
            }
            saved = JSON.stringify(draft);
            window.dispatchEvent(new Event(CHANGED_EVENT));
            renderList(); name.value = draft[selected]?.name || ""; validate();
            validation.textContent = "已保存";
            if (closeAfter) close();
        };
        this.closeSettings = close;
        action("cancel").onclick = close;
        action("save").onclick = () => save(false);
        action("done").onclick = () => save(true);
        dialog.addEventListener("cancel", event => { event.preventDefault(); close(); });
        dialog.addEventListener("keydown", event => {
            event.stopPropagation();
            if (!event.isComposing && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
                event.preventDefault(); save(false);
            }
        });
        dialog.addEventListener("pointerdown", event => event.stopPropagation());
        dialog.addEventListener("wheel", event => event.stopPropagation(), { passive: true });
        renderList(); renderEditor(); document.body.append(dialog); dialog.showModal();
    }

    destroy() {
        this.events.abort();
        this.closeSettings?.();
        this.menu.remove();
    }
}
