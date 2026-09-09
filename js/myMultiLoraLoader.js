/*
 * Canvas widget interaction adapted from rgthree-comfy's Power Lora Loader.
 *
 * MIT License
 * Copyright (c) 2023 Regis Gaughan, III (rgthree)
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { RgthreeLoraInfoDialog } from "/extensions/wzq_test_node/lorainfo/lorainfo.js";

const NODE_NAME = "myMultiLoraLoaderModelOnlyxxx";
const ROW_PREFIX = "lora_";
const DEFAULT_VALUE = Object.freeze({ on: true, lora: null, strength: 1.0 });
const NUMBER_WIDTH = 56;
const ROW_HEIGHT = 26;
const NODE_MIN_WIDTH = 460;
const LORA_MENU_CLASS = "wzq-multi-lora-menu";

let loraNamesPromise = null;

async function getLoraNames(force = false) {
    if (!loraNamesPromise || force) {
        loraNamesPromise = api.fetchApi("/wzq/api/loras")
            .then((response) => {
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }
                return response.json();
            })
            .then((data) => Array.isArray(data.loras) ? data.loras : [])
            .catch((error) => {
                loraNamesPromise = null;
                console.error("[Multi Lora Loader] Failed to load LoRA names:", error);
                return [];
            });
    }
    return loraNamesPromise;
}

function buildLoraMenuOptions(loras, callback) {
    const root = { folders: new Map(), files: [] };

    for (const lora of loras) {
        const parts = String(lora).split(/[/\\]+/).filter(Boolean);
        if (!parts.length) {
            continue;
        }

        const fileName = parts.pop();
        let branch = root;
        for (const folderName of parts) {
            if (!branch.folders.has(folderName)) {
                branch.folders.set(folderName, { folders: new Map(), files: [] });
            }
            branch = branch.folders.get(folderName);
        }
        branch.files.push({ name: fileName, value: lora });
    }

    const makeOptions = (branch) => {
        const options = [];
        const folders = [...branch.folders.entries()]
            .sort(([left], [right]) => left.localeCompare(right, undefined, { numeric: true }));
        const files = [...branch.files]
            .sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true }));

        for (const [folderName, child] of folders) {
            options.push({
                content: `📁 ${folderName}`,
                has_submenu: true,
                submenu: {
                    options: makeOptions(child),
                },
            });
        }
        for (const file of files) {
            options.push({
                content: file.name,
                callback: () => callback(file.value),
            });
        }
        return options;
    };

    return [
        {
            content: "None",
            callback: () => callback("None"),
        },
        null,
        ...makeOptions(root),
    ];
}

function closeLoraMenus() {
    for (const menu of document.querySelectorAll(".litecontextmenu")) {
        menu.remove();
    }
}

function installLoraMenuHoverStyle() {
    const styleId = "wzq-multi-lora-menu-hover-style";
    if (document.getElementById(styleId)) {
        return;
    }

    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = `
        .litecontextmenu.${LORA_MENU_CLASS} .litemenu-entry:hover {
            background-color: var(--content-hover-bg, #4a4a4a) !important;
            color: var(--input-text, #fff) !important;
        }
    `;
    document.head.appendChild(style);
}

function trackLoraMenus() {
    installLoraMenuHoverStyle();

    const tagMenus = (root) => {
        if (root instanceof Element && root.matches(".litecontextmenu")) {
            root.classList.add(LORA_MENU_CLASS);
        }
        root.querySelectorAll?.(".litecontextmenu").forEach((menu) => {
            menu.classList.add(LORA_MENU_CLASS);
        });
    };

    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            mutation.addedNodes.forEach(tagMenus);
        }

        if (!document.querySelector(`.litecontextmenu.${LORA_MENU_CLASS}`)) {
            observer.disconnect();
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return observer;
}

function addLoraSearch(menu, loras, callback) {
    if (!menu) {
        return;
    }

    let input = menu.querySelector(".comfy-context-menu-filter");
    if (!input) {
        input = document.createElement("input");
        input.type = "text";
        input.className = "comfy-context-menu-filter";
        input.autocomplete = "off";
        input.spellcheck = false;
        menu.prepend(input);
    }
    input.placeholder = "Search LoRA name or path…";

    const regularEntries = [...menu.children].filter(
        (element) => element !== input && element.classList?.contains("litemenu-entry"),
    );
    const results = document.createElement("div");
    results.className = "wzq-lora-search-results";
    results.style.display = "none";
    input.insertAdjacentElement("afterend", results);
    let visibleMatches = [];
    let activeIndex = 0;

    const updateActiveResult = () => {
        const entries = [...results.querySelectorAll(".litemenu-entry")];
        entries.forEach((entry, index) => {
            entry.style.backgroundColor = index === activeIndex ? "var(--content-hover-bg, #444)" : "";
        });
        entries[activeIndex]?.scrollIntoView({ block: "nearest" });
    };

    const renderResults = () => {
        const tokens = input.value.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
        const isSearching = tokens.length > 0;
        results.replaceChildren();
        results.style.display = isSearching ? "block" : "none";
        regularEntries.forEach((entry) => {
            entry.style.display = isSearching ? "none" : "";
        });
        if (!isSearching) {
            return;
        }

        const matches = loras.filter((lora) => {
            const searchable = String(lora).toLocaleLowerCase();
            return tokens.every((token) => searchable.includes(token));
        });
        visibleMatches = matches.slice(0, 250);
        activeIndex = 0;

        visibleMatches.forEach((lora, index) => {
            const normalized = String(lora).replaceAll("\\", "/");
            const separator = normalized.lastIndexOf("/");
            const folder = separator >= 0 ? normalized.slice(0, separator + 1) : "";
            const fileName = separator >= 0 ? normalized.slice(separator + 1) : normalized;

            const entry = document.createElement("div");
            entry.className = "litemenu-entry";
            entry.dataset.value = lora;
            entry.style.cursor = "pointer";

            if (folder) {
                const prefix = document.createElement("span");
                prefix.textContent = folder;
                prefix.style.opacity = "0.45";
                prefix.style.fontSize = "0.85em";
                prefix.style.marginRight = "5px";
                entry.appendChild(prefix);
            }
            entry.appendChild(document.createTextNode(fileName));
            entry.addEventListener("pointerdown", (event) => {
                event.preventDefault();
                event.stopPropagation();
                callback(lora);
                closeLoraMenus();
            });
            entry.addEventListener("pointerenter", () => {
                activeIndex = index;
                updateActiveResult();
            });
            results.appendChild(entry);
        });

        if (!matches.length || matches.length > 250) {
            const status = document.createElement("div");
            status.style.padding = "6px 10px";
            status.style.opacity = "0.65";
            status.textContent = matches.length
                ? `Showing first 250 of ${matches.length} LoRAs`
                : "No matching LoRA";
            results.appendChild(status);
        }
        updateActiveResult();
    };

    input.addEventListener("pointerdown", (event) => event.stopPropagation());
    input.addEventListener("click", (event) => event.stopPropagation());
    input.addEventListener("input", renderResults);
    input.addEventListener("keydown", (event) => {
        if (!input.value.trim()) {
            return;
        }
        if (event.key === "ArrowDown" && visibleMatches.length) {
            activeIndex = (activeIndex + 1) % visibleMatches.length;
        } else if (event.key === "ArrowUp" && visibleMatches.length) {
            activeIndex = (activeIndex - 1 + visibleMatches.length) % visibleMatches.length;
        } else if (event.key === "Enter" && visibleMatches[activeIndex]) {
            callback(visibleMatches[activeIndex]);
            closeLoraMenus();
        } else if (event.key === "Escape") {
            closeLoraMenus();
        } else {
            return;
        }
        event.preventDefault();
        event.stopImmediatePropagation();
        updateActiveResult();
    }, true);
    requestAnimationFrame(() => input.focus());
}

async function showLoraChooser(event, callback) {
    const loras = await getLoraNames();
    const existingMenus = new Set(document.querySelectorAll(".litecontextmenu"));
    const menuObserver = trackLoraMenus();
    new LiteGraph.ContextMenu(buildLoraMenuOptions(loras, callback), {
        event,
        title: "Choose a LoRA",
        className: "dark",
        scale: Math.max(1, app.canvas?.ds?.scale || 1),
    });
    const createdMenus = [...document.querySelectorAll(".litecontextmenu")]
        .filter((menu) => !existingMenus.has(menu));
    createdMenus.forEach((menu) => menu.classList.add(LORA_MENU_CLASS));
    if (!createdMenus.length) {
        menuObserver.disconnect();
    }
    addLoraSearch(createdMenus.at(-1), loras, callback);
}

function isLowQuality() {
    return (app.canvas?.ds?.scale || 1) <= 0.5;
}

function fitText(ctx, text, maxWidth) {
    const value = String(text ?? "");
    if (ctx.measureText(value).width <= maxWidth) {
        return value;
    }
    const ellipsis = "…";
    let low = 0;
    let high = value.length;
    while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if (ctx.measureText(value.slice(0, middle) + ellipsis).width <= maxWidth) {
            low = middle;
        } else {
            high = middle - 1;
        }
    }
    return value.slice(0, low) + ellipsis;
}

function drawRoundedRectangle(ctx, x, y, width, height, background, stroke, radius = height / 2) {
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, isLowQuality() ? [0] : [radius]);
    ctx.fillStyle = background;
    ctx.fill();
    if (!isLowQuality() && stroke) {
        ctx.strokeStyle = stroke;
        ctx.stroke();
    }
    ctx.restore();
}

function drawToggle(ctx, x, y, height, value) {
    const width = height * 1.5;
    ctx.save();
    if (!isLowQuality()) {
        ctx.beginPath();
        ctx.roundRect(x + 4, y + 4, width - 8, height - 8, [height / 2]);
        ctx.globalAlpha = (app.canvas?.editor_alpha || 1) * 0.25;
        ctx.fillStyle = "rgba(255,255,255,.45)";
        ctx.fill();
        ctx.globalAlpha = app.canvas?.editor_alpha || 1;
    }
    ctx.fillStyle = value === true ? "#89a5d0" : "#888";
    const toggleX = value === true ? x + height : value === false ? x + height / 2 : x + height * 0.75;
    ctx.beginPath();
    ctx.arc(toggleX, y + height / 2, height * 0.36, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return [x, width];
}

function drawNumberControl(ctx, rightX, y, height, value) {
    const arrowWidth = 9;
    const gap = 3;
    const textWidth = 32;
    const totalWidth = arrowWidth + gap + textWidth + gap + arrowWidth;
    let x = rightX - totalWidth;
    const middleY = y + height / 2;

    ctx.save();
    ctx.fillStyle = LiteGraph.WIDGET_TEXT_COLOR;
    ctx.beginPath();
    ctx.moveTo(x, middleY);
    ctx.lineTo(x + arrowWidth, middleY + 5);
    ctx.lineTo(x + arrowWidth, middleY - 5);
    ctx.closePath();
    ctx.fill();
    const decrease = [x, arrowWidth];

    x += arrowWidth + gap;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(Number(value).toFixed(2), x + textWidth / 2, middleY);
    const number = [x, textWidth];

    x += textWidth + gap;
    ctx.beginPath();
    ctx.moveTo(x, middleY - 5);
    ctx.lineTo(x + arrowWidth, middleY);
    ctx.lineTo(x, middleY + 5);
    ctx.closePath();
    ctx.fill();
    const increase = [x, arrowWidth];
    ctx.restore();

    return {
        decrease,
        number,
        increase,
        all: [rightX - totalWidth, totalWidth],
        left: rightX - totalWidth,
    };
}

function drawInfoIcon(ctx, x, y, size) {
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, y, size, size, [2]);
    ctx.strokeStyle = "#aaa";
    ctx.stroke();
    ctx.fillStyle = "#ddd";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `bold ${Math.max(10, size - 4)}px sans-serif`;
    ctx.fillText("i", x + size / 2, y + size / 2 + 0.5);
    ctx.restore();
}

function drawButton(ctx, node, y, height, label, pressed) {
    const x = 15;
    const width = node.size[0] - 30;
    drawRoundedRectangle(
        ctx,
        x,
        y + (pressed ? 1 : 0),
        width,
        height,
        pressed ? "#444" : LiteGraph.WIDGET_BGCOLOR,
        LiteGraph.WIDGET_OUTLINE_COLOR,
        5,
    );
    if (!isLowQuality()) {
        ctx.save();
        ctx.fillStyle = LiteGraph.WIDGET_TEXT_COLOR;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(label, node.size[0] / 2, y + height / 2 + (pressed ? 1 : 0));
        ctx.restore();
    }
}

class CanvasWidget {
    constructor(name, serialize = false) {
        this.name = name;
        this.type = "custom";
        this.value = null;
        this.options = { serialize };
        this.last_y = 0;
        this.hitAreas = {};
        this.mouseDowned = false;
        this.movedAreas = [];
        this.clickedAreas = [];
    }

    computeSize(width) {
        return [width, ROW_HEIGHT];
    }

    isInside(pos, bounds) {
        return pos[0] >= bounds[0] && pos[0] <= bounds[0] + bounds[1];
    }

    cancelMouseDown() {
        this.mouseDowned = false;
        this.movedAreas.length = 0;
        this.clickedAreas.length = 0;
    }

    mouse(event, pos, node) {
        if (event.type === "pointerdown") {
            this.mouseDowned = true;
            this.movedAreas.length = 0;
            this.clickedAreas.length = 0;
            let handled = false;
            for (const area of Object.values(this.hitAreas)) {
                if (!this.isInside(pos, area.bounds)) {
                    continue;
                }
                if (area.onMove) {
                    this.movedAreas.push(area);
                }
                if (area.onClick) {
                    this.clickedAreas.push(area);
                }
                if (area.onDown) {
                    handled = area.onDown.call(this, event, pos, node) === true || handled;
                }
            }
            return handled || this.onMouseDown?.(event, pos, node) === true;
        }

        if (event.type === "pointermove") {
            for (const area of this.movedAreas) {
                area.onMove.call(this, event, pos, node);
            }
            return this.mouseDowned;
        }

        if (event.type === "pointerup") {
            if (!this.mouseDowned) {
                return false;
            }
            let handled = false;
            for (const area of this.clickedAreas) {
                if (this.isInside(pos, area.bounds)) {
                    handled = area.onClick.call(this, event, pos, node) === true || handled;
                }
            }
            this.cancelMouseDown();
            this.onMouseUp?.(event, pos, node);
            return handled || true;
        }
        return false;
    }
}

class SpacerWidget extends CanvasWidget {
    constructor(height = 4) {
        super("multi_lora_spacer", false);
        this.height = height;
    }

    draw(ctx, node, width, y) {
        this.last_y = y;
    }

    computeSize(width) {
        return [width, this.height];
    }
}

class HeaderWidget extends CanvasWidget {
    constructor() {
        super("multi_lora_header", false);
        this.hitAreas.toggle = {
            bounds: [10, 50],
            onDown(event, pos, node) {
                node.toggleAllMultiLoras();
                this.cancelMouseDown();
                return true;
            },
        };
    }

    draw(ctx, node, width, y, height) {
        this.last_y = y;
        const rows = node.getMultiLoraWidgets();
        if (!rows.length) {
            return;
        }
        const allOn = rows.every((widget) => widget.value.on);
        const allOff = rows.every((widget) => !widget.value.on);
        const state = allOn ? true : allOff ? false : null;
        const toggleBounds = drawToggle(ctx, 10, y, height, state);
        this.hitAreas.toggle.bounds = toggleBounds;

        if (!isLowQuality()) {
            ctx.save();
            ctx.globalAlpha = (app.canvas?.editor_alpha || 1) * 0.55;
            ctx.fillStyle = LiteGraph.WIDGET_TEXT_COLOR;
            ctx.textBaseline = "middle";
            ctx.textAlign = "left";
            ctx.fillText("Toggle All", toggleBounds[0] + toggleBounds[1] + 4, y + height / 2);
            ctx.textAlign = "right";
            ctx.fillText("Model Strength", node.size[0] - 14, y + height / 2);
            ctx.restore();
        }
    }
}

class LoraRowWidget extends CanvasWidget {
    constructor(name, value = DEFAULT_VALUE) {
        super(name, true);
        this._value = { ...DEFAULT_VALUE };
        this.haveDraggedStrength = false;
        this.value = value;
        this.hitAreas = {
            toggle: {
                bounds: [10, 40],
                onDown(event, pos, node) {
                    this.value.on = !this.value.on;
                    node.syncMultiLoraState();
                    this.cancelMouseDown();
                    return true;
                },
            },
            lora: {
                bounds: [50, 100],
                onClick(event, pos, node) {
                    showLoraChooser(event, (selected) => {
                        if (typeof selected === "string") {
                            this.value.lora = selected === "None" ? null : selected;
                            node.syncMultiLoraState();
                        }
                    });
                    return true;
                },
            },
            info: {
                bounds: [0, 0],
                onDown() {
                    this.showInfo();
                    this.cancelMouseDown();
                    return true;
                },
            },
            decrease: {
                bounds: [0, 0],
                onClick(event, pos, node) {
                    this.stepStrength(-0.05);
                    node.syncMultiLoraState();
                    return true;
                },
            },
            number: {
                bounds: [0, 0],
                onClick(event, pos, node) {
                    if (!this.haveDraggedStrength) {
                        app.canvas.prompt("Model strength", this.value.strength, (input) => {
                            const parsed = Number(input);
                            if (Number.isFinite(parsed)) {
                                this.value.strength = clampStrength(parsed);
                                node.syncMultiLoraState();
                            }
                        }, event);
                    }
                    return true;
                },
            },
            increase: {
                bounds: [0, 0],
                onClick(event, pos, node) {
                    this.stepStrength(0.05);
                    node.syncMultiLoraState();
                    return true;
                },
            },
            strength: {
                bounds: [0, NUMBER_WIDTH],
                onMove(event, pos, node) {
                    const delta = event.deltaX ?? event.movementX ?? 0;
                    if (delta) {
                        this.haveDraggedStrength = true;
                        this.value.strength = clampStrength(
                            this.value.strength + delta * 0.05 / (app.canvas?.ds?.scale || 1),
                        );
                        node.syncMultiLoraState();
                    }
                },
            },
        };
    }

    set value(value) {
        const normalized = value && typeof value === "object" ? value : DEFAULT_VALUE;
        this._value = {
            on: normalized.on !== false,
            lora: typeof normalized.lora === "string" && normalized.lora !== "None"
                ? normalized.lora
                : null,
            strength: Number.isFinite(Number(normalized.strength))
                ? clampStrength(Number(normalized.strength))
                : 1.0,
        };
    }

    get value() {
        return this._value;
    }

    serializeValue() {
        return { ...this.value };
    }

    computeSize(width) {
        return [width, ROW_HEIGHT + 2];
    }

    draw(ctx, node, width, y, height) {
        this.last_y = y;
        drawRoundedRectangle(
            ctx,
            10,
            y,
            node.size[0] - 20,
            height,
            LiteGraph.WIDGET_BGCOLOR,
            LiteGraph.WIDGET_OUTLINE_COLOR,
        );

        const toggleBounds = drawToggle(ctx, 10, y, height, this.value.on);
        this.hitAreas.toggle.bounds = toggleBounds;
        if (!this.value.on) {
            ctx.save();
            ctx.globalAlpha = (app.canvas?.editor_alpha || 1) * 0.4;
        }

        const rightX = node.size[0] - 14;
        const numberBounds = drawNumberControl(ctx, rightX, y, height, this.value.strength);
        this.hitAreas.decrease.bounds = numberBounds.decrease;
        this.hitAreas.number.bounds = numberBounds.number;
        this.hitAreas.increase.bounds = numberBounds.increase;
        this.hitAreas.strength.bounds = numberBounds.all;

        const infoSize = Math.min(18, height * 0.68);
        const infoX = numberBounds.left - infoSize - 9;
        drawInfoIcon(ctx, infoX, y + (height - infoSize) / 2, infoSize);
        this.hitAreas.info.bounds = [infoX - 2, infoSize + 4];

        const labelX = toggleBounds[0] + toggleBounds[1] + 4;
        const labelWidth = infoX - labelX - 7;
        ctx.save();
        ctx.fillStyle = LiteGraph.WIDGET_TEXT_COLOR;
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText(
            fitText(ctx, this.value.lora || "None", Math.max(20, labelWidth)),
            labelX,
            y + height / 2,
        );
        ctx.restore();
        this.hitAreas.lora.bounds = [labelX, Math.max(20, labelWidth)];

        if (!this.value.on) {
            ctx.restore();
        }
    }

    stepStrength(amount) {
        this.value.strength = clampStrength(this.value.strength + amount);
    }

    showInfo() {
        if (this.value.lora) {
            new RgthreeLoraInfoDialog(this.value.lora).show();
        }
    }

    onMouseUp() {
        this.haveDraggedStrength = false;
    }
}

class AddButtonWidget extends CanvasWidget {
    constructor() {
        super("multi_lora_add", false);
    }

    draw(ctx, node, width, y, height) {
        this.last_y = y;
        drawButton(ctx, node, y, height, "➕ Add LoRA", this.mouseDowned);
    }

    mouse(event, pos, node) {
        if (event.type === "pointerdown") {
            this.mouseDowned = true;
            return true;
        }
        if (event.type === "pointerup" && this.mouseDowned) {
            this.mouseDowned = false;
            showLoraChooser(event, (selected) => {
                if (typeof selected === "string" && selected !== "None") {
                    node.addMultiLoraWidget({ ...DEFAULT_VALUE, lora: selected });
                    resizeNode(node);
                }
            });
            return true;
        }
        return false;
    }
}

function clampStrength(value) {
    return Math.max(-20, Math.min(20, Math.round(value * 100) / 100));
}

function moveArrayItem(array, item, newIndex) {
    const oldIndex = array.indexOf(item);
    if (oldIndex < 0 || newIndex < 0 || newIndex >= array.length) {
        return;
    }
    array.splice(oldIndex, 1);
    array.splice(newIndex, 0, item);
}

function resizeNode(node) {
    requestAnimationFrame(() => {
        const computed = node.computeSize();
        node.setSize?.([Math.max(node.size?.[0] || 0, NODE_MIN_WIDTH), computed[1]]);
        node.setDirtyCanvas?.(true, true);
    });
}

function addStaticWidgets(node) {
    node.addCustomWidget(new SpacerWidget(4));
    node.multiLoraHeader = node.addCustomWidget(new HeaderWidget());
    node.multiLoraBottomSpacer = node.addCustomWidget(new SpacerWidget(5));
    node.multiLoraAddButton = node.addCustomWidget(new AddButtonWidget());
}

function setupNode(node) {
    node.serialize_widgets = true;
    node.multiLoraCounter = 0;

    node.getMultiLoraWidgets = function () {
        return (this.widgets || []).filter(
            (widget) => widget instanceof LoraRowWidget && widget.name.startsWith(ROW_PREFIX),
        );
    };

    node.syncMultiLoraState = function () {
        this.setDirtyCanvas?.(true, true);
        this.graph?.setDirtyCanvas?.(true, true);
    };

    node.addMultiLoraWidget = function (value) {
        this.multiLoraCounter += 1;
        const widget = this.addCustomWidget(
            new LoraRowWidget(`${ROW_PREFIX}${this.multiLoraCounter}`, value),
        );
        const targetIndex = this.widgets.indexOf(this.multiLoraBottomSpacer);
        if (targetIndex >= 0) {
            moveArrayItem(this.widgets, widget, targetIndex);
        }
        this.syncMultiLoraState();
        return widget;
    };

    node.removeMultiLoraWidget = function (widget) {
        const index = this.widgets.indexOf(widget);
        if (index >= 0) {
            this.widgets.splice(index, 1);
            widget.onRemove?.();
            resizeNode(this);
        }
    };

    node.toggleAllMultiLoras = function () {
        const rows = this.getMultiLoraWidgets();
        const target = !rows.length || !rows.every((widget) => widget.value.on);
        rows.forEach((widget) => {
            widget.value.on = target;
        });
        this.syncMultiLoraState();
    };

    node.restoreMultiLoraWidgets = function (values) {
        for (const widget of this.widgets || []) {
            widget.onRemove?.();
        }
        this.widgets = [];
        this.multiLoraCounter = 0;
        addStaticWidgets(this);
        for (const value of values || []) {
            if (value && typeof value === "object" && "lora" in value) {
                this.addMultiLoraWidget(value);
            }
        }
        resizeNode(this);
    };

    addStaticWidgets(node);
    getLoraNames();
    resizeNode(node);
}

function setupNodeType(nodeType) {
    const originalOnNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
        const result = originalOnNodeCreated?.apply(this, arguments);
        setupNode(this);
        return result;
    };

    const originalOnConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (info) {
        let savedRows = (info?.widgets_values || []).filter(
            (value) => value && typeof value === "object" && "lora" in value,
        );
        // Migrate workflows saved by the earlier hidden-JSON implementation.
        if (!savedRows.length) {
            const legacyValues = [
                ...(info?.widgets_values || []).filter((value) => typeof value === "string"),
                info?.properties?.multi_loras_data,
            ];
            for (const legacyValue of legacyValues) {
                if (!legacyValue) {
                    continue;
                }
                try {
                    const parsed = JSON.parse(legacyValue);
                    if (Array.isArray(parsed)) {
                        savedRows = parsed;
                        break;
                    }
                } catch {
                    // It was not the legacy JSON payload.
                }
            }
        }
        const result = originalOnConfigure?.apply(this, arguments);
        requestAnimationFrame(() => this.restoreMultiLoraWidgets?.(savedRows));
        return result;
    };

    const originalGetSlotInPosition = nodeType.prototype.getSlotInPosition;
    nodeType.prototype.getSlotInPosition = function (canvasX, canvasY) {
        const slot = originalGetSlotInPosition?.apply(this, arguments);
        if (slot) {
            return slot;
        }
        for (const widget of this.getMultiLoraWidgets?.() || []) {
            const top = this.pos[1] + (widget.last_y || 0);
            if (canvasY >= top && canvasY <= top + ROW_HEIGHT + 2) {
                return { widget, output: { type: "LORA_WIDGET" } };
            }
        }
        return undefined;
    };

    const originalGetSlotMenuOptions = nodeType.prototype.getSlotMenuOptions;
    nodeType.prototype.getSlotMenuOptions = function (slot) {
        if (slot?.widget instanceof LoraRowWidget) {
            const widget = slot.widget;
            const rows = this.getMultiLoraWidgets();
            const rowIndex = rows.indexOf(widget);
            const widgetIndex = this.widgets.indexOf(widget);
            return [
                {
                    content: "ⓘ Show Info",
                    disabled: !widget.value.lora,
                    callback: () => widget.showInfo(),
                },
                null,
                {
                    content: widget.value.on ? "⚪ Toggle Off" : "🔵 Toggle On",
                    callback: () => {
                        widget.value.on = !widget.value.on;
                        this.syncMultiLoraState();
                    },
                },
                {
                    content: "⬆ Move Up",
                    disabled: rowIndex <= 0,
                    callback: () => {
                        moveArrayItem(this.widgets, widget, widgetIndex - 1);
                        this.syncMultiLoraState();
                    },
                },
                {
                    content: "⬇ Move Down",
                    disabled: rowIndex < 0 || rowIndex >= rows.length - 1,
                    callback: () => {
                        moveArrayItem(this.widgets, widget, widgetIndex + 1);
                        this.syncMultiLoraState();
                    },
                },
                {
                    content: "🗑 Remove",
                    callback: () => this.removeMultiLoraWidget(widget),
                },
            ];
        }
        return originalGetSlotMenuOptions?.apply(this, arguments);
    };

    const originalGetExtraMenuOptions = nodeType.prototype.getExtraMenuOptions;
    nodeType.prototype.getExtraMenuOptions = function (canvas, options) {
        const result = originalGetExtraMenuOptions?.apply(this, arguments);
        options.unshift({
            content: "🔄 Refresh LoRA List",
            callback: async () => {
                await getLoraNames(true);
                this.syncMultiLoraState?.();
            },
        });
        return result;
    };
}

app.registerExtension({
    name: "wzq.MultiLoraLoaderModelOnly",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name === NODE_NAME) {
            setupNodeType(nodeType);
        }
    },
});
