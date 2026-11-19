import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = (await readFile(new URL("../js/Local_Lora_Only_Gallery.js", import.meta.url), "utf8"))
    .replace(/^import .*;\r?$/gm, "");

test("sorting requests use the node's independent routes", async () => {
    const requests = [];
    const context = vm.createContext({
        app: { registerExtension() {} }, console,
        api: { async fetchApi(url) { requests.push(url); return { json: async () => ({ loras: [] }) }; } },
    });
    vm.runInContext(source + "\nglobalThis.gallery = LocalLoraOnlyGalleryNode;", context);
    for (const order of ["name", "date_desc", "date_asc"]) {
        await context.gallery.getLoras("tag", "OR", "folder", 2, ["selected.safetensors"], "search", order);
        const url = new URL(requests.at(-1), "http://localhost");
        assert.equal(url.pathname, "/wzq/localloragallery/get_loras");
        assert.equal(url.searchParams.get("sort_order"), order);
        assert.equal(url.searchParams.get("selected_loras"), "selected.safetensors");
        assert.equal(url.searchParams.get("page"), "2");
    }
    await context.gallery.setUiState("1", "gallery", { sort_order: "date_desc" });
    assert.equal(requests.at(-1), "/wzq/localloragallery/set_ui_state");
});

test("changing sort during loading refreshes with the latest choice", async () => {
    const start = source.indexOf("            let refreshPending = false;");
    const end = source.indexOf("            const handleTagSelectionChange", start);
    const requests = [];
    let finishFirstRequest;
    const firstRequest = new Promise(resolve => { finishFirstRequest = resolve; });
    const renders = [];
    const node = { loraData: [], availableLoras: [], currentPage: 1, totalPages: 3 };
    const sortOrderSelect = { value: "name" };
    const context = vm.createContext({
        searchInput: { value: "" }, tagFilterInput: { value: "" }, tagFilterModeBtn: { textContent: "OR" },
        folderFilterSelect: { value: "" }, sortOrderSelect,
        galleryEl: { scrollTop: 100 }, foldersRendered: true,
        renderGallery() { renders.push(node.availableLoras.map(lora => lora.name)); },
        LocalLoraOnlyGalleryNode: {
            async getLoras(...args) {
                this.isLoading = true;
                requests.push({ page: args[3], order: args[6] });
                if (requests.length === 1) await firstRequest;
                this.isLoading = false;
                return { loras: [{ name: args[6] }], folders: [] };
            },
        },
    });
    const fetch = vm.runInContext(`(function () { ${source.slice(start, end)} return fetchAndRender; })`, context).call(node);
    const initial = fetch();
    sortOrderSelect.value = "date_desc";
    await fetch();
    await fetch(true);
    sortOrderSelect.value = "date_asc";
    await fetch();
    finishFirstRequest();
    await initial;
    assert.deepEqual(requests, [{ page: 1, order: "name" }, { page: 1, order: "date_asc" }]);
    assert.deepEqual(renders, [["date_asc"]]);
});
