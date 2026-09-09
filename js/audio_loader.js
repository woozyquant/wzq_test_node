import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const NODE_NAME = "WZQAudioLoader";
const HANDLE_LINE_WIDTH_PX = 4;
const HANDLE_HIT_PX = HANDLE_LINE_WIDTH_PX / 2;
const AUDIO_EXTENSIONS = new Set([
    "mp3", "wav", "ogg", "flac", "aac", "m4a", "wma", "opus",
    "amr", "ac3", "aiff", "aif", "au", "mka", "mp2", "ra", "voc", "w64",
]);

const findWidget = (node, name) => node.widgets?.find((item) => item.name === name);
const roundTime = (value) => Math.round(value * 1000) / 1000;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function isAudio(file) {
    return Boolean(file && AUDIO_EXTENSIONS.has(String(file.name).split(".").pop().toLowerCase()));
}

function splitAnnotated(value) {
    let name = String(value || "");
    let type = "input";
    for (const candidate of ["input", "output", "temp"]) {
        const suffix = ` [${candidate}]`;
        if (name.endsWith(suffix)) {
            name = name.slice(0, -suffix.length);
            type = candidate;
            break;
        }
    }
    return { name, type };
}

function audioUrl(filename) {
    const { name, type } = splitAnnotated(filename);
    const params = new URLSearchParams({ filename: name, type, rand: String(Date.now()) });
    return api.apiURL(`/view?${params}`);
}

function setWidget(node, name, value) {
    const item = findWidget(node, name);
    if (!item) return;
    item.value = value;
    item.callback?.(value);
    node.graph?.setDirtyCanvas(true, true);
}

function hideWidget(item) {
    if (!item) return;
    item.type = "hidden";
    item.hidden = true;
    item.computeSize = () => [0, 0];
}

async function uploadFile(file) {
    const body = new FormData();
    body.append("image", file, file.name);
    body.append("type", "input");
    body.append("overwrite", "true");
    const response = await api.fetchApi("/upload/image", { method: "POST", body });
    if (!response.ok) throw new Error(await response.text());
    return response.json();
}

async function refreshAudioChoices(widget, selected) {
    const response = await api.fetchApi(`/object_info/${NODE_NAME}`);
    if (!response.ok) return;
    const data = await response.json();
    const values = data?.[NODE_NAME]?.input?.required?.audio?.[0];
    if (!Array.isArray(values)) return;
    widget.options.values = values;
    if (values.includes(selected)) widget.value = selected;
    widget.callback?.(widget.value);
}

function formatTime(seconds) {
    const value = Math.max(0, Number(seconds) || 0);
    const minutes = Math.floor(value / 60);
    const remainder = value - minutes * 60;
    return `${String(minutes).padStart(2, "0")}:${remainder.toFixed(2).padStart(5, "0")}`;
}

class AudioPanel {
    constructor(node) {
        this.node = node;
        this.peaks = [];
        this.total = 0;
        this.start = 0;
        this.end = 0;
        this.dragHandle = null;
        this.raf = 0;
        this.requestSerial = 0;
        this.audio = document.createElement("audio");
        this.audio.preload = "metadata";
        this.audio.style.display = "none";
        document.body.appendChild(this.audio);
        this.build();
        this.bind();
    }

    build() {
        const root = document.createElement("div");
        root.style.cssText = "width:100%;height:100%;min-height:190px;box-sizing:border-box;padding:8px;display:flex;flex-direction:column;gap:7px;background:#151515;border:1px solid var(--border-color);border-radius:6px;color:#ddd;font:12px sans-serif;overflow:hidden;";

        const toolbar = document.createElement("div");
        toolbar.style.cssText = "display:grid;grid-template-columns:auto auto auto 1fr auto;gap:6px;align-items:center;";
        this.uploadButton = document.createElement("button");
        this.uploadButton.textContent = "上传音频";
        this.playButton = document.createElement("button");
        this.playButton.textContent = "▶";
        this.playText = document.createElement("span");
        this.playText.style.cssText = "min-width:84px;text-align:center;font-variant-numeric:tabular-nums;color:#8fd18f;white-space:nowrap;";
        this.timeText = document.createElement("span");
        this.timeText.style.cssText = "text-align:center;font-variant-numeric:tabular-nums;color:#bbb;white-space:nowrap;";
        const resetButton = document.createElement("button");
        resetButton.textContent = "重置截断";
        for (const button of [this.uploadButton, this.playButton, resetButton]) {
            button.type = "button";
            button.style.cssText = "padding:5px 8px;background:var(--comfy-input-bg);color:var(--input-text);border:1px solid var(--border-color);border-radius:4px;cursor:pointer;";
        }
        toolbar.append(this.uploadButton, this.playButton, this.playText, this.timeText, resetButton);

        this.canvas = document.createElement("canvas");
        this.canvas.style.cssText = "display:block;width:100%;height:112px;min-height:70px;flex:1;background:#202225;border-radius:4px;cursor:crosshair;touch-action:none;";

        const footer = document.createElement("div");
        footer.style.cssText = "display:grid;grid-template-columns:1fr 1fr auto 110px;gap:8px;align-items:center;font-variant-numeric:tabular-nums;";
        this.startText = document.createElement("span");
        this.endText = document.createElement("span");
        this.startText.style.color = "#ff6767";
        this.endText.style.color = "#64a8ff";
        const volumeLabel = document.createElement("span");
        volumeLabel.textContent = "音量 100%";
        this.volumeLabel = volumeLabel;
        this.volume = document.createElement("input");
        this.volume.type = "range";
        this.volume.min = "0";
        this.volume.max = "3";
        this.volume.step = "0.01";
        this.volume.value = "1";
        this.volume.style.width = "110px";
        footer.append(this.startText, this.endText, volumeLabel, this.volume);

        this.fileInput = document.createElement("input");
        this.fileInput.type = "file";
        this.fileInput.accept = [...AUDIO_EXTENSIONS].map((ext) => `.${ext}`).join(",");
        this.fileInput.style.display = "none";
        root.append(toolbar, this.canvas, footer, this.fileInput);
        this.root = root;
        this.updateLabels();
        this.node.addDOMWidget("wzq_audio_panel", "div", root, {
            serialize: false,
            hideOnZoom: false,
            getMinHeight: () => 205,
        });

        this.uploadButton.onclick = () => {
            this.fileInput.value = "";
            this.fileInput.click();
        };
        this.playButton.onclick = () => this.togglePlay();
        resetButton.onclick = () => this.setRange(0, this.total, true);
        this.volume.oninput = () => {
            const value = Number(this.volume.value);
            this.audio.volume = Math.min(1, value);
            this.volumeLabel.textContent = `音量 ${Math.round(value * 100)}%`;
            setWidget(this.node, "volume", value);
        };
        this.fileInput.onchange = () => this.handleFiles(this.fileInput.files);
        root.ondragover = (event) => {
            if ([...event.dataTransfer.files].some(isAudio)) event.preventDefault();
        };
        root.ondrop = (event) => {
            const files = [...event.dataTransfer.files].filter(isAudio);
            if (!files.length) return;
            event.preventDefault();
            event.stopPropagation();
            this.handleFiles(files);
        };
    }

    bind() {
        this.resizeObserver = new ResizeObserver(() => this.draw());
        this.resizeObserver.observe(this.canvas);
        this.canvas.addEventListener("pointerdown", (event) => {
            if (!this.total) return;
            const time = this.timeAt(event);
            this.dragHandle = this.handleAt(event);
            if (!this.dragHandle) {
                this.audio.currentTime = clamp(time, this.start, this.end);
                this.updatePlayTime();
                this.draw();
                return;
            }
            this.canvas.setPointerCapture(event.pointerId);
            this.updateDrag(event);
        });
        this.canvas.addEventListener("pointermove", (event) => {
            if (this.dragHandle) {
                this.updateDrag(event);
            } else {
                this.canvas.style.cursor = this.handleAt(event) ? "ew-resize" : "crosshair";
            }
        });
        const finish = (event) => {
            if (!this.dragHandle) return;
            this.updateDrag(event);
            this.dragHandle = null;
        };
        this.canvas.addEventListener("pointerup", finish);
        this.canvas.addEventListener("pointercancel", finish);
        this.canvas.addEventListener("pointerleave", () => {
            if (!this.dragHandle) this.canvas.style.cursor = "crosshair";
        });
        this.canvas.ondblclick = () => this.togglePlay();
        this.audio.onplay = () => {
            this.playButton.textContent = "❚❚";
            this.animate();
        };
        this.audio.onpause = () => {
            this.playButton.textContent = "▶";
            cancelAnimationFrame(this.raf);
            this.updatePlayTime();
        };
        this.audio.onloadedmetadata = () => {
            this.updatePlayTime();
            this.draw();
        };
    }

    timeAt(event) {
        const rect = this.canvas.getBoundingClientRect();
        return clamp((event.clientX - rect.left) / Math.max(1, rect.width) * this.total, 0, this.total);
    }

    handleAt(event) {
        if (!this.total) return null;
        const rect = this.canvas.getBoundingClientRect();
        const pointerX = event.clientX - rect.left;
        const startX = this.start / this.total * rect.width;
        const endX = this.end / this.total * rect.width;
        const startDistance = Math.abs(pointerX - startX);
        const endDistance = Math.abs(pointerX - endX);
        const nearestDistance = Math.min(startDistance, endDistance);
        if (nearestDistance > HANDLE_HIT_PX) return null;
        return startDistance <= endDistance ? "start" : "end";
    }

    updateDrag(event) {
        const time = this.timeAt(event);
        const gap = Math.min(0.01, this.total);
        if (this.dragHandle === "start") this.start = clamp(time, 0, Math.max(0, this.end - gap));
        else this.end = clamp(time, Math.min(this.total, this.start + gap), this.total);
        this.commitRange();
    }

    commitRange() {
        this.start = roundTime(this.start);
        this.end = roundTime(this.end);
        setWidget(this.node, "start_time", this.start);
        setWidget(this.node, "duration", roundTime(Math.max(0, this.end - this.start)));
        if (this.audio.currentTime < this.start || this.audio.currentTime > this.end) this.audio.currentTime = this.start;
        this.updateLabels();
        this.draw();
    }

    setRange(start, end, commit = false) {
        this.start = clamp(Number(start) || 0, 0, this.total);
        this.end = clamp(Number(end) || this.total, this.start, this.total);
        if (commit) this.commitRange();
        else {
            this.updateLabels();
            this.draw();
        }
    }

    updateLabels() {
        this.startText.textContent = `起点 ${formatTime(this.start)}`;
        this.endText.textContent = `终点 ${formatTime(this.end)}`;
        const cutDuration = roundTime(Math.max(0, this.end - this.start));
        this.timeText.textContent = `${formatTime(this.start)} — ${formatTime(this.end)} / ${formatTime(this.total)}（截取 ${cutDuration.toFixed(2)} 秒）`;
        this.updatePlayTime();
    }

    updatePlayTime() {
        const current = clamp(Number(this.audio.currentTime) || 0, 0, this.total);
        this.playText.textContent = `当前 ${formatTime(current)}`;
    }

    draw() {
        const rect = this.canvas.getBoundingClientRect();
        const ratio = window.devicePixelRatio || 1;
        const width = Math.max(1, Math.round(rect.width * ratio));
        const height = Math.max(1, Math.round(rect.height * ratio));
        if (this.canvas.width !== width || this.canvas.height !== height) {
            this.canvas.width = width;
            this.canvas.height = height;
        }
        const ctx = this.canvas.getContext("2d");
        ctx.clearRect(0, 0, width, height);
        ctx.fillStyle = "#202225";
        ctx.fillRect(0, 0, width, height);
        const middle = height / 2;
        ctx.strokeStyle = "#3d4248";
        ctx.beginPath();
        ctx.moveTo(0, middle);
        ctx.lineTo(width, middle);
        ctx.stroke();
        if (!this.peaks.length || !this.total) {
            ctx.fillStyle = "#8a9199";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.font = `${12 * ratio}px sans-serif`;
            ctx.fillText("选择或拖入音频文件", width / 2, middle);
            return;
        }
        const startX = this.start / this.total * width;
        const endX = this.end / this.total * width;
        const barWidth = width / this.peaks.length;
        this.peaks.forEach((peak, index) => {
            const x = index * barWidth;
            const selected = x + barWidth >= startX && x <= endX;
            ctx.strokeStyle = selected ? "#67d391" : "#697078";
            ctx.beginPath();
            ctx.moveTo(x, middle - Math.max(1, peak[1] * middle * 0.88));
            ctx.lineTo(x, middle - Math.min(-1, peak[0] * middle * 0.88));
            ctx.stroke();
        });
        ctx.fillStyle = "rgba(0,0,0,.38)";
        ctx.fillRect(0, 0, startX, height);
        ctx.fillRect(endX, 0, width - endX, height);
        for (const [x, color] of [[startX, "#ff5d5d"], [endX, "#58a5ff"]]) {
            ctx.fillStyle = color;
            ctx.fillRect(x - HANDLE_LINE_WIDTH_PX / 2 * ratio, 0, HANDLE_LINE_WIDTH_PX * ratio, height);
            ctx.beginPath();
            ctx.moveTo(x - 7 * ratio, 0);
            ctx.lineTo(x + 7 * ratio, 0);
            ctx.lineTo(x, 9 * ratio);
            ctx.fill();
        }
        const current = Number.isFinite(this.audio.currentTime) ? this.audio.currentTime : this.start;
        const playX = current / this.total * width;
        ctx.strokeStyle = "rgba(255,255,255,.8)";
        ctx.beginPath();
        ctx.moveTo(playX, 0);
        ctx.lineTo(playX, height);
        ctx.stroke();
    }

    animate() {
        cancelAnimationFrame(this.raf);
        const frame = () => {
            if (this.audio.paused) return;
            if (this.audio.currentTime >= this.end) {
                this.audio.pause();
                this.audio.currentTime = this.start;
            }
            this.draw();
            this.updatePlayTime();
            this.raf = requestAnimationFrame(frame);
        };
        this.raf = requestAnimationFrame(frame);
    }

    togglePlay() {
        if (!this.audio.src || !this.total) return;
        if (!this.audio.paused) {
            this.audio.pause();
            return;
        }
        if (this.audio.currentTime < this.start || this.audio.currentTime >= this.end) {
            this.audio.currentTime = this.start;
            this.updatePlayTime();
        }
        this.audio.play().catch((error) => console.warn("[WZQ Audio Loader] 播放失败", error));
    }

    async load(filename, preserveRange = false) {
        const serial = ++this.requestSerial;
        if (!filename) {
            this.peaks = [];
            this.total = 0;
            this.audio.removeAttribute("src");
            this.setRange(0, 0);
            return;
        }
        try {
            const response = await api.fetchApi(`/wzq/audio-loader/waveform?filename=${encodeURIComponent(filename)}`);
            const data = await response.json();
            if (serial !== this.requestSerial) return;
            if (!response.ok) throw new Error(data.error || "波形加载失败");
            this.peaks = data.peaks || [];
            this.total = Number(data.duration) || 0;
            this.audio.src = audioUrl(filename);
            this.audio.load();
            if (preserveRange) {
                const start = Number(findWidget(this.node, "start_time")?.value) || 0;
                const duration = Number(findWidget(this.node, "duration")?.value) || 0;
                this.setRange(start, duration > 0 ? start + duration : this.total);
            } else {
                this.setRange(0, this.total, true);
            }
        } catch (error) {
            console.warn("[WZQ Audio Loader]", error);
            this.peaks = [];
            this.total = 0;
            this.updateLabels();
            this.draw();
        }
    }

    async handleFiles(fileList) {
        const file = [...fileList].find(isAudio);
        if (!file) return;
        try {
            const result = await uploadFile(file);
            const audioWidget = findWidget(this.node, "audio");
            if (!audioWidget || !result.name) return;
            await refreshAudioChoices(audioWidget, result.name);
            await this.load(audioWidget.value);
        } catch (error) {
            console.error("[WZQ Audio Loader] 上传失败", error);
        }
    }

    destroy() {
        cancelAnimationFrame(this.raf);
        this.resizeObserver?.disconnect();
        this.audio.pause();
        this.audio.remove();
    }
}

app.registerExtension({
    name: "wzq.audio_loader",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== NODE_NAME) return;
        // Older server processes may still expose the legacy audio_upload
        // option until ComfyUI is restarted.  It maps to a broken AUDIOUPLOAD
        // widget in recent frontends, so remove it before inputs are built.
        const audioSpec = nodeData.input?.required?.audio;
        if (audioSpec?.[1]) delete audioSpec[1].audio_upload;
        const originalCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const result = originalCreated?.apply(this, arguments);
            hideWidget(findWidget(this, "start_time"));
            hideWidget(findWidget(this, "duration"));
            hideWidget(findWidget(this, "volume"));
            this.setSize([Math.max(560, this.size?.[0] || 0), Math.max(285, this.size?.[1] || 0)]);
            this.minWidth = 380;
            this.minHeight = 250;
            this._wzqAudioPanel = new AudioPanel(this);
            const audioWidget = findWidget(this, "audio");
            if (audioWidget) {
                const callback = audioWidget.callback;
                audioWidget.callback = (value) => {
                    callback?.call(audioWidget, value);
                    this._wzqAudioPanel?.load(value);
                };
                if (audioWidget.value) requestAnimationFrame(() => this._wzqAudioPanel?.load(audioWidget.value, true));
            }
            return result;
        };

        const originalConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function () {
            const result = originalConfigure?.apply(this, arguments);
            requestAnimationFrame(() => {
                hideWidget(findWidget(this, "start_time"));
                hideWidget(findWidget(this, "duration"));
                hideWidget(findWidget(this, "volume"));
                const volume = Number(findWidget(this, "volume")?.value) || 0;
                if (this._wzqAudioPanel) {
                    this._wzqAudioPanel.volume.value = String(volume);
                    this._wzqAudioPanel.volume.oninput();
                    this._wzqAudioPanel.load(findWidget(this, "audio")?.value, true);
                }
            });
            return result;
        };

        const originalRemoved = nodeType.prototype.onRemoved;
        nodeType.prototype.onRemoved = function () {
            this._wzqAudioPanel?.destroy();
            return originalRemoved?.apply(this, arguments);
        };

        // The new ComfyUI frontend renders a per-node DropZone that reads these
        // two methods straight off the node object, the same contract its
        // upload nodes use, so a file can be dropped anywhere on the node.
        const hasFileItems = (event) => [...event.dataTransfer?.items || []].some((item) => item.kind === "file");
        const originalOnDragOver = nodeType.prototype.onDragOver;
        nodeType.prototype.onDragOver = function (event) {
            return hasFileItems(event) || Boolean(originalOnDragOver?.call(this, event));
        };
        const originalOnDragDrop = nodeType.prototype.onDragDrop;
        nodeType.prototype.onDragDrop = async function (event) {
            const files = [...event.dataTransfer?.files || []].filter(isAudio);
            if (files.length && this._wzqAudioPanel) {
                await this._wzqAudioPanel.handleFiles(files);
                return true;
            }
            return Boolean(await originalOnDragDrop?.call(this, event));
        };
    },
});
