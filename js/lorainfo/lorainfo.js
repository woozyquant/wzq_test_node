import { RgthreeDialog } from "./dialog.js";
import { createElement as $el, empty, appendChildren, getClosestOrSelf, query, queryAll, setAttributes, } from "./utils_dom.js";
import { logoCivitai, link, pencilColored, diskColored, dotdotdot, } from "./svgs.js";
import { LORA_INFO_SERVICE, CHECKPOINT_INFO_SERVICE } from "./model_info_service.js";
import { MenuButton } from "./menu.js";
import { generateId, injectCss } from "./shared_utils.js";

// Create a simple message function to replace rgthree.showMessage
const showMessage = ({ id, type, message, timeout }) => {
    console.log(`[${type.toUpperCase()}] ${message}`);
    // You could integrate with a toast notification system here
    // For now, we'll use alert as a fallback
    // alert(`${type.toUpperCase()}: ${message}`);
};

class RgthreeInfoDialog extends RgthreeDialog {
    constructor(file) {
        const dialogOptions = {
            class: "rgthree-info-dialog",
            title: `<h2>Loading...</h2>`,
            content: "<center>Loading..</center>",
            onBeforeClose: () => {
                return true;
            },
        };
        super(dialogOptions);
        this.modifiedModelData = false;
        this.modelInfo = null;
        this.init(file);
    }

    async init(file) {
        var _a, _b;
        const cssPromise = injectCss("/extensions/wzq_test_node/lorainfo/css/dialog_model_info.css");
        this.modelInfo = await this.getModelInfo(file);
        await cssPromise;
        // 并行拉取 lora 文件大小，完成后刷新内容显示
        this.fileSizeText = "";
        this.fetchFileSize(file);
        this.setContent(this.getInfoContent());
        this.setTitle(((_a = this.modelInfo) === null || _a === void 0 ? void 0 : _a["name"]) || ((_b = this.modelInfo) === null || _b === void 0 ? void 0 : _b["file"]) || "Unknown");
        this.attachEvents();
    }

    async fetchFileSize(file) {
        try {
            const resp = await fetch(`/wzq/api/lora_size?file=${encodeURIComponent(file)}`);
            if (!resp.ok) return;
            const data = await resp.json();
            if (data && data.status === 200 && typeof data.sizeBytes === "number") {
                this.fileSizeText = formatFileSize(data.sizeBytes);
                // 仅刷新内容，保留滚动位置等
                this.setContent(this.getInfoContent());
            }
        } catch (err) {
            console.error("[wzq] Failed to fetch lora file size:", err);
        }
    }

    getCloseEventDetail() {
        const detail = {
            dirty: this.modifiedModelData,
        };
        return { detail };
    }

    attachEvents() {
        this.contentElement.addEventListener("click", async (e) => {
            const target = getClosestOrSelf(e.target, "[data-action]");
            const action = target === null || target === void 0 ? void 0 : target.getAttribute("data-action");
            if (!target || !action) {
                return;
            }
            await this.handleEventAction(action, target, e);
        });
    }

    async handleEventAction(action, target, e) {
        var _a, _b;
        const info = this.modelInfo;
        if (!(info === null || info === void 0 ? void 0 : info.file)) {
            return;
        }
        if (action === "fetch-civitai") {
            this.modelInfo = await this.refreshModelInfo(info.file);
            this.setContent(this.getInfoContent());
            this.setTitle(((_a = this.modelInfo) === null || _a === void 0 ? void 0 : _a["name"]) || ((_b = this.modelInfo) === null || _b === void 0 ? void 0 : _b["file"]) || "Unknown");
        }
        else if (action === "copy-trained-words") {
            const selected = queryAll(".-rgthree-is-selected", target.closest("tr"));
            const text = selected.map((el) => el.getAttribute("data-word")).join(", ");
            await navigator.clipboard.writeText(text);
            showMessage({
                id: "copy-trained-words-" + generateId(4),
                type: "success",
                message: `Successfully copied ${selected.length} key word${selected.length === 1 ? "" : "s"}.`,
                timeout: 4000,
            });
        }
        else if (action === "toggle-trained-word") {
            target === null || target === void 0 ? void 0 : target.classList.toggle("-rgthree-is-selected");
            const tr = target.closest("tr");
            if (tr) {
                const span = query("td:first-child > *", tr);
                let small = query("small", span);
                if (!small) {
                    small = $el("small", { parent: span });
                }
                const num = queryAll(".-rgthree-is-selected", tr).length;
                small.innerHTML = num
                    ? `${num} selected | <span role="button" data-action="copy-trained-words">Copy</span>`
                    : "";
            }
        }
        else if (action === "edit-row") {
            const tr = target.closest("tr");
            const td = query("td:nth-child(2)", tr);
            const input = td.querySelector("input,textarea");
            if (!input) {
                const fieldName = tr.dataset["fieldName"];
                tr.classList.add("-rgthree-editing");

                // 合并的 Strength Range 行：编辑时渲染两个输入框（min - max）
                if (fieldName === "strengthRange") {
                    const min = info.strengthMin != null ? info.strengthMin : "";
                    const max = info.strengthMax != null ? info.strengthMax : "";
                    const wrapper = $el("div", { style: "display:flex; align-items:center; gap:6px; padding:4px 8px;" });
                    const minInput = $el('input[type="text"]', { value: String(min), placeholder: "min", style: "width:80px; padding:5px 8px; border:0; box-shadow:inset 1px 1px 5px 0 rgba(0,0,0,.5); background:#fff; color:#121212;" });
                    const sep = $el("span", { text: "–", style: "color:#999;" });
                    const maxInput = $el('input[type="text"]', { value: String(max), placeholder: "max", style: "width:80px; padding:5px 8px; border:0; box-shadow:inset 1px 1px 5px 0 rgba(0,0,0,.5); background:#fff; color:#121212;" });
                    appendChildren(wrapper, [minInput, sep, maxInput]);
                    appendChildren(empty(td), [wrapper]);
                    minInput.focus();

                    const commit = (save) => {
                        const modified = saveStrengthRangeRow(info, tr, save, minInput, maxInput);
                        this.modifiedModelData = this.modifiedModelData || modified;
                    };
                    const onKey = (e) => {
                        if (e.key === "Enter") { commit(true); e.stopPropagation(); e.preventDefault(); }
                        else if (e.key === "Escape") { commit(false); e.stopPropagation(); e.preventDefault(); }
                    };
                    minInput.addEventListener("keydown", onKey);
                    maxInput.addEventListener("keydown", onKey);
                    return;
                }

                const isTextarea = fieldName === "userNote";
                const input = $el(`${isTextarea ? "textarea" : 'input[type="text"]'}`, {
                    value: td.textContent,
                });
                input.addEventListener("keydown", (e) => {
                    if (!isTextarea && e.key === "Enter") {
                        const modified = saveEditableRow(info, tr, true);
                        this.modifiedModelData = this.modifiedModelData || modified;
                        e.stopPropagation();
                        e.preventDefault();
                    }
                    else if (e.key === "Escape") {
                        const modified = saveEditableRow(info, tr, false);
                        this.modifiedModelData = this.modifiedModelData || modified;
                        e.stopPropagation();
                        e.preventDefault();
                    }
                });
                appendChildren(empty(td), [input]);
                input.focus();
            }
            else if (target.nodeName.toLowerCase() === "button") {
                const fieldName = tr.dataset["fieldName"];
                if (fieldName === "strengthRange") {
                    const inputs = td.querySelectorAll("input");
                    const modified = saveStrengthRangeRow(info, tr, true, inputs[0], inputs[1]);
                    this.modifiedModelData = this.modifiedModelData || modified;
                } else {
                    const modified = saveEditableRow(info, tr, true);
                    this.modifiedModelData = this.modifiedModelData || modified;
                }
            }
            e === null || e === void 0 ? void 0 : e.preventDefault();
            e === null || e === void 0 ? void 0 : e.stopPropagation();
        }
    }

    getInfoContent() {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _w, _x, _y;
        const info = this.modelInfo || {};
        const civitaiLink = (_a = info.links) === null || _a === void 0 ? void 0 : _a.find((i) => i.includes("civitai.com/models"));
        const html = `
      <ul class="rgthree-info-area">
        <li title="Type" class="rgthree-info-tag -type -type-${(info.type || "").toLowerCase()}"><span>${info.type || ""}</span></li>
        <li title="Base Model" class="rgthree-info-tag -basemodel -basemodel-${(info.baseModel || "").toLowerCase()}"><span>${info.baseModel || ""}</span></li>
        <li class="rgthree-info-menu" stub="menu"></li>
        ${""}
      </ul>

      <table class="rgthree-info-table">
        ${infoTableRow("File", info.file || "")}
        ${infoTableRow("File Size", this.fileSizeText || "")}
        ${infoTableRow("Hash (sha256)", info.sha256 || "")}
        ${civitaiLink
            ? infoTableRow("Civitai", `<a href="${civitaiLink}" target="_blank">${logoCivitai}View on Civitai</a>`)
            : ((_c = (_b = info.raw) === null || _b === void 0 ? void 0 : _b.civitai) === null || _c === void 0 ? void 0 : _c.error) === "Model not found"
                ? infoTableRow("Civitai", '<i>Model not found</i> <span class="-help" title="The model was not found on civitai with the sha256 hash. It\'s possible the model was removed, re-uploaded, or was never on civitai to begin with."></span>')
                : ((_e = (_d = info.raw) === null || _d === void 0 ? void 0 : _d.civitai) === null || _e === void 0 ? void 0 : _e.error)
                    ? infoTableRow("Civitai", (_g = (_f = info.raw) === null || _f === void 0 ? void 0 : _f.civitai) === null || _g === void 0 ? void 0 : _g.error)
                    : !((_h = info.raw) === null || _h === void 0 ? void 0 : _h.civitai)
                        ? infoTableRow("Civitai", `<button class="rgthree-button" data-action="fetch-civitai">Fetch info from civitai</button>`)
                        : ""}

        ${infoTableRow("Name", info.name || ((_k = (_j = info.raw) === null || _j === void 0 ? void 0 : _j.metadata) === null || _k === void 0 ? void 0 : _k.ss_output_name) || "", "The name for display.", "name")}

        ${!info.baseModelFile && !info.baseModelFile
            ? ""
            : infoTableRow("Base Model", (info.baseModel || "") + (info.baseModelFile ? ` (${info.baseModelFile})` : ""))}


        ${!((_l = info.trainedWords) === null || _l === void 0 ? void 0 : _l.length)
            ? ""
            : infoTableRow("Trained Words", (_m = getTrainedWordsMarkup(info.trainedWords)) !== null && _m !== void 0 ? _m : "", "Trained words from the metadata and/or civitai. Click to select for copy.")}

        ${!((_p = (_o = info.raw) === null || _o === void 0 ? void 0 : _o.metadata) === null || _p === void 0 ? void 0 : _p.ss_clip_skip) || ((_r = (_q = info.raw) === null || _q === void 0 ? void 0 : _q.metadata) === null || _r === void 0 ? void 0 : _r.ss_clip_skip) == "None"
            ? ""
            : infoTableRow("Clip Skip", (_t = (_s = info.raw) === null || _s === void 0 ? void 0 : _s.metadata) === null || _t === void 0 ? void 0 : _t.ss_clip_skip)}
        ${infoTableRow("Strength Range", formatStrengthRange(info.strengthMin, info.strengthMax), "The recommended strength range. In the Power Lora Loader node, strength will signal when it is outside this range.", "strengthRange")}
        ${""}
        ${infoTableRow("Additional Notes", (_w = info.userNote) !== null && _w !== void 0 ? _w : "", "Additional notes you'd like to keep and reference in the info dialog.", "userNote")}

      </table>

      <ul class="rgthree-info-images">${(_y = (_x = info.images) === null || _x === void 0 ? void 0 : _x.map((img) => `
        <li>
          <figure>${img.type === 'video'
            ? `<video src="${img.url}" autoplay loop></video>`
            : `<img src="${img.url}" />`}
            <figcaption><!--
              -->${imgInfoField("", img.civitaiUrl
            ? `<a href="${img.civitaiUrl}" target="_blank">civitai${link}</a>`
            : undefined)}<!--
              -->${imgInfoField("seed", img.seed)}<!--
              -->${imgInfoField("steps", img.steps)}<!--
              -->${imgInfoField("cfg", img.cfg)}<!--
              -->${imgInfoField("sampler", img.sampler)}<!--
              -->${imgInfoField("model", img.model)}<!--
              -->${imgInfoField("positive", img.positive)}<!--
              -->${imgInfoField("negative", img.negative)}<!--
            --><!--${""}--></figcaption>
          </figure>
        </li>`).join("")) !== null && _y !== void 0 ? _y : ""}</ul>
    `;
        const div = $el("div", { html });
        
        // Remove the dev mode menu for now
        // if (rgthree.isDevMode()) {
        //     setAttributes(query('[stub="menu"]', div), {
        //         children: [
        //             new MenuButton({
        //                 icon: dotdotdot,
        //                 options: [
        //                     { label: "More Actions", type: "title" },
        //                     {
        //                         label: "Open API JSON",
        //                         callback: async (e) => {
        //                             var _a;
        //                             if ((_a = this.modelInfo) === null || _a === void 0 ? void 0 : _a.file) {
        //                                 window.open(`rgthree/api/loras/info?file=${encodeURIComponent(this.modelInfo.file)}`);
        //                             }
        //                         },
        //                     },
        //                     {
        //                         label: "Clear all local info",
        //                         callback: async (e) => {
        //                             var _a, _b, _c;
        //                             if ((_a = this.modelInfo) === null || _a === void 0 ? void 0 : _a.file) {
        //                                 this.modelInfo = await LORA_INFO_SERVICE.clearFetchedInfo(this.modelInfo.file);
        //                                 this.setContent(this.getInfoContent());
        //                                 this.setTitle(((_b = this.modelInfo) === null || _b === void 0 ? void 0 : _b["name"]) || ((_c = this.modelInfo) === null || _c === void 0 ? void 0 : _c["file"]) || "Unknown");
        //                             }
        //                         },
        //                     },
        //                 ],
        //             }),
        //         ],
        //     });
        // }
        
        return div;
    }
}

export class RgthreeLoraInfoDialog extends RgthreeInfoDialog {
    async getModelInfo(file) {
        return LORA_INFO_SERVICE.getInfo(file, false, false);
    }

    async refreshModelInfo(file) {
        return LORA_INFO_SERVICE.refreshInfo(file);
    }

    async clearModelInfo(file) {
        return LORA_INFO_SERVICE.clearFetchedInfo(file);
    }
}

export class RgthreeCheckpointInfoDialog extends RgthreeInfoDialog {
    async getModelInfo(file) {
        return CHECKPOINT_INFO_SERVICE.getInfo(file, false, false);
    }

    async refreshModelInfo(file) {
        return CHECKPOINT_INFO_SERVICE.refreshInfo(file);
    }

    async clearModelInfo(file) {
        return CHECKPOINT_INFO_SERVICE.clearFetchedInfo(file);
    }
}

function infoTableRow(name, value, help = "", editableFieldName = "") {
    return `
    <tr class="${editableFieldName ? "editable" : ""}" ${editableFieldName ? `data-field-name="${editableFieldName}"` : ""}>
      <td><span>${name} ${help ? `<span class="-help" title="${help}"></span>` : ""}<span></td>
      <td ${editableFieldName ? "" : 'colspan="2"'}>${String(value).startsWith("<") ? value : `<span>${value}<span>`}</td>
      ${editableFieldName
        ? `<td style="width: 24px;"><button class="rgthree-button-reset rgthree-button-edit" data-action="edit-row">${pencilColored}${diskColored}</button></td>`
        : ""}
    </tr>`;
}

function getTrainedWordsMarkup(words) {
    let markup = `<ul class="rgthree-info-trained-words-list">`;
    for (const wordData of words || []) {
        markup += `<li title="${wordData.word}" data-word="${wordData.word}" class="rgthree-info-trained-words-list-item" data-action="toggle-trained-word">
      <span>${wordData.word}</span>
      ${wordData.civitai ? logoCivitai : ""}
      ${wordData.count != null ? `<small>${wordData.count}</small>` : ""}
    </li>`;
    }
    markup += `</ul>`;
    return markup;
}

function saveEditableRow(info, tr, saving = true) {
    var _a;
    const fieldName = tr.dataset["fieldName"];
    const input = query("input,textarea", tr);
    let newValue = (_a = info[fieldName]) !== null && _a !== void 0 ? _a : "";
    let modified = false;
    if (saving) {
        newValue = input.value;
        if (fieldName.startsWith("strength")) {
            if (Number.isNaN(Number(newValue))) {
                alert(`You must enter a number into the ${fieldName} field.`);
                return false;
            }
            newValue = (Math.round(Number(newValue) * 100) / 100).toFixed(2);
        }
        LORA_INFO_SERVICE.savePartialInfo(info.file, { [fieldName]: newValue });
        modified = true;
    }
    tr.classList.remove("-rgthree-editing");
    const td = query("td:nth-child(2)", tr);
    appendChildren(empty(td), [$el("span", { text: newValue })]);
    return modified;
}

function imgInfoField(label, value) {
    return value != null ? `<span>${label ? `<label>${label} </label>` : ""}${value}</span>` : "";
}

/**
 * 将 strengthMin / strengthMax 合并展示为 "min – max" 形式。
 * 两者都为空时返回空串；只有一个时单独显示该值。
 */
function formatStrengthRange(strengthMin, strengthMax) {
    const hasMin = strengthMin != null && strengthMin !== "";
    const hasMax = strengthMax != null && strengthMax !== "";
    if (hasMin && hasMax) {
        return `${formatStrengthValue(strengthMin)} – ${formatStrengthValue(strengthMax)}`;
    }
    if (hasMin) return formatStrengthValue(strengthMin);
    if (hasMax) return formatStrengthValue(strengthMax);
    return "";
}

/** 把数值格式化为两位小数字符串。 */
function formatStrengthValue(value) {
    const num = Number(value);
    if (Number.isNaN(num)) return String(value);
    return (Math.round(num * 100) / 100).toFixed(2);
}

/** 把字节数格式化为人类可读的大小，如 "144.32 MB"。 */
function formatFileSize(sizeBytes) {
    if (sizeBytes == null || Number.isNaN(Number(sizeBytes))) return "";
    const bytes = Number(sizeBytes);
    if (bytes < 1024) return `${bytes} B`;
    const units = ["KB", "MB", "GB", "TB"];
    let value = bytes / 1024;
    let unitIdx = 0;
    while (value >= 1024 && unitIdx < units.length - 1) {
        value /= 1024;
        unitIdx++;
    }
    return `${value.toFixed(2)} ${units[unitIdx]}`;
}

/**
 * 保存合并后的 Strength Range 行。
 * 将两个输入框的值写回 info.strengthMin / info.strengthMax，
 * 并通过 savePartialInfo 一次性提交两个字段。
 */
function saveStrengthRangeRow(info, tr, saving = true, minInput, maxInput) {
    let minVal = info.strengthMin != null ? info.strengthMin : "";
    let maxVal = info.strengthMax != null ? info.strengthMax : "";
    let modified = false;
    if (saving) {
        minVal = minInput ? minInput.value.trim() : "";
        maxVal = maxInput ? maxInput.value.trim() : "";
        if (minVal !== "" && Number.isNaN(Number(minVal))) {
            alert("You must enter a number into the Strength Range (min) field.");
            return false;
        }
        if (maxVal !== "" && Number.isNaN(Number(maxVal))) {
            alert("You must enter a number into the Strength Range (max) field.");
            return false;
        }
        minVal = minVal !== "" ? (Math.round(Number(minVal) * 100) / 100).toFixed(2) : "";
        maxVal = maxVal !== "" ? (Math.round(Number(maxVal) * 100) / 100).toFixed(2) : "";
        info.strengthMin = minVal;
        info.strengthMax = maxVal;
        LORA_INFO_SERVICE.savePartialInfo(info.file, { strengthMin: minVal, strengthMax: maxVal });
        modified = true;
    }
    tr.classList.remove("-rgthree-editing");
    const td = query("td:nth-child(2)", tr);
    appendChildren(empty(td), [$el("span", { text: formatStrengthRange(minVal, maxVal) })]);
    return modified;
}
