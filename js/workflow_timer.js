import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";

const NODE_NAME = "WZQWorkflowTimer";
const ID_PROPERTY = "wzq_timer_id";
const RESULT_PROPERTY = "wzq_timer_result";
const panels = new Set();
const states = new Map();
const jobs = new Map();
const earlyEvents = new Map();
const labels = {
    idle: "等待生成", running: "运行中", done: "已完成",
    error: "执行失败", interrupted: "已中断", disconnected: "连接中断 · 待确认",
};
let submitting = 0;
let ticker = null;

function formatDuration(milliseconds) {
    const centiseconds = Math.floor(Math.max(0, milliseconds) / 10);
    const two = value => String(value).padStart(2, "0");
    return `${two(Math.floor(centiseconds / 360000))}:${two(Math.floor(centiseconds / 6000) % 60)}:${two(Math.floor(centiseconds / 100) % 60)}.${two(centiseconds % 100)}`;
}

function formatTime(timestamp) {
    return timestamp == null ? "—" : new Date(timestamp).toLocaleTimeString("zh-CN", { hour12: false });
}

function elapsedTime(state) {
    return state.status === "running" ? performance.now() - state.startedAt : state.elapsed;
}

function refresh(id) {
    const state = states.get(id);
    for (const panel of panels) {
        if (panel.id !== id) continue;
        panel.render(state);
        if (["done", "error", "interrupted"].includes(state.status)) {
            panel.node.properties[RESULT_PROPERTY] = {
                status: state.status, elapsed: state.elapsed, start: state.start,
                end: state.end, previous: state.previous,
            };
        }
    }
}

function updateTicker() {
    const running = [...panels].some(panel => states.get(panel.id)?.status === "running");
    if (running && ticker == null) {
        ticker = setInterval(() => {
            for (const panel of panels) {
                const state = states.get(panel.id);
                if (state?.status === "running") panel.renderClock(state);
            }
        }, 100);
    } else if (!running && ticker != null) {
        clearInterval(ticker);
        ticker = null;
    }
}

function pruneStates() {
    if (submitting || states.size <= 256) return;
    const retained = new Set([...panels].map(panel => panel.id));
    for (const job of jobs.values()) for (const id of job.ids) retained.add(id);
    for (const id of states.keys()) {
        if (!retained.has(id)) states.delete(id);
        if (states.size <= 256) break;
    }
}

function handleExecution(type, detail, receivedAt = performance.now()) {
    const job = jobs.get(detail.prompt_id);
    if (!job) {
        // The WebSocket may deliver a whole cached run before POST /prompt returns.
        if (submitting && earlyEvents.size < 256) {
            const events = earlyEvents.get(detail.prompt_id) || [];
            if (!events.some(event => event.type === type)) events.push({ type, detail, receivedAt });
            earlyEvents.set(detail.prompt_id, events);
        }
        return;
    }
    if (type === "execution_start") {
        if (job.started) return;
        job.started = true;
        for (const id of job.ids) {
            const state = states.get(id);
            state.previous = ["done", "error", "interrupted"].includes(state.status) ? state.elapsed : state.previous;
            Object.assign(state, {
                status: "running", promptId: detail.prompt_id, start: detail.timestamp ?? Date.now(),
                serverStart: detail.timestamp, startedAt: receivedAt, end: null, elapsed: 0,
            });
            refresh(id);
        }
    } else {
        for (const id of job.ids) {
            const state = states.get(id);
            if (!job.started || state.promptId !== detail.prompt_id) continue;
            const elapsed = Number.isFinite(state.serverStart) && Number.isFinite(detail.timestamp)
                ? detail.timestamp - state.serverStart : receivedAt - state.startedAt;
            Object.assign(state, {
                status: type === "execution_success" ? "done" : type === "execution_interrupted" ? "interrupted" : "error",
                end: detail.timestamp ?? Date.now(), elapsed: Math.max(0, elapsed),
            });
            refresh(id);
        }
        jobs.delete(detail.prompt_id);
        pruneStates();
    }
    updateTicker();
}

function timerIds(workflow) {
    return [...new Set((workflow?.nodes || [])
        .filter(node => node.type === NODE_NAME && node.mode !== 2 && node.mode !== 4)
        .map(node => node.properties?.[ID_PROPERTY]).filter(id => states.has(id)))];
}

async function recoverDisconnectedJobs() {
    for (const [promptId, job] of jobs) {
        if (!job.started || !job.ids.some(id => states.get(id)?.status === "disconnected")) continue;
        try {
            const response = await api.fetchApi(`/history/${encodeURIComponent(promptId)}`);
            if (!response.ok) continue;
            const history = (await response.json())[promptId];
            const terminal = history?.status?.messages?.find(([type]) =>
                ["execution_success", "execution_error", "execution_interrupted"].includes(type));
            if (terminal) handleExecution(terminal[0], terminal[1]);
        } catch (error) {
            console.warn("WZQ 计时器无法确认任务结果：", error);
        }
    }
}

class WorkflowTimerPanel {
    constructor(node) {
        this.node = node;
        this.root = document.createElement("div");
        this.root.className = "wzq-workflow-timer";
        this.root.innerHTML = `
            <div class="wzq-timer-head"><span class="wzq-timer-status"><span class="wzq-timer-dot"></span><span class="wzq-timer-status-text" role="status" aria-live="polite"></span></span><span class="wzq-timer-scope">整个工作流</span></div>
            <div class="wzq-timer-label">本次生成耗时</div>
            <div class="wzq-timer-clock" role="timer" aria-label="本次生成耗时"><span class="wzq-timer-main"></span><span class="wzq-timer-fraction"></span></div>
            <dl class="wzq-timer-details"><dt>开始时间</dt><dd class="wzq-timer-start"></dd><dt>结束时间</dt><dd class="wzq-timer-end"></dd><dt>上次耗时</dt><dd class="wzq-timer-previous"></dd></dl>
            <div class="wzq-timer-foot"><span>自动开始 / 停止</span><span>无需连线</span></div>`;
        this.status = this.root.querySelector(".wzq-timer-status-text");
        this.label = this.root.querySelector(".wzq-timer-label");
        this.main = this.root.querySelector(".wzq-timer-main");
        this.fraction = this.root.querySelector(".wzq-timer-fraction");
        this.start = this.root.querySelector(".wzq-timer-start");
        this.end = this.root.querySelector(".wzq-timer-end");
        this.previous = this.root.querySelector(".wzq-timer-previous");
        node.addDOMWidget("wzq_workflow_timer", "div", this.root, {
            serialize: false, hideOnZoom: false, getMinHeight: () => 300,
        });
        node.isVirtualNode = true;
        node.minWidth = 340;
        node.minHeight = 340;
        node.setSize([Math.max(340, node.size[0]), Math.max(340, node.size[1])]);
        panels.add(this);
        this.bind();
    }

    bind() {
        let id = this.node.properties[ID_PROPERTY];
        const duplicate = [...panels].some(panel => panel !== this && panel.id === id);
        if (!id || duplicate) {
            id = Array.from(crypto.getRandomValues(new Uint8Array(16)), value => value.toString(16).padStart(2, "0")).join("");
            this.node.properties[ID_PROPERTY] = id;
            delete this.node.properties[RESULT_PROPERTY];
        }
        this.id = id;
        if (!states.has(id)) {
            const saved = this.node.properties[RESULT_PROPERTY];
            const valid = saved && ["done", "error", "interrupted"].includes(saved.status)
                && Number.isFinite(saved.elapsed) && saved.elapsed >= 0;
            states.set(id, valid ? { ...saved } : { status: "idle", elapsed: 0, start: null, end: null, previous: null });
        }
        refresh(id);
        updateTicker();
        pruneStates();
    }

    renderClock(state) {
        const duration = formatDuration(elapsedTime(state));
        const point = duration.indexOf(".");
        this.main.textContent = duration.slice(0, point);
        this.fraction.textContent = duration.slice(point);
    }

    render(state) {
        this.root.dataset.status = state.status;
        this.status.textContent = labels[state.status];
        this.label.textContent = state.status === "running" ? "本次已运行" : state.status === "disconnected" ? "最后确认耗时" : "本次生成耗时";
        this.renderClock(state);
        this.start.textContent = formatTime(state.start);
        this.end.textContent = state.status === "running" ? "运行中…" : state.status === "disconnected" ? "待确认" : formatTime(state.end);
        this.previous.textContent = state.previous == null ? "—" : formatDuration(state.previous);
    }

    destroy() {
        panels.delete(this);
        this.root.remove();
        updateTicker();
        pruneStates();
    }
}

function attachPanel(node) {
    if (node._wzqWorkflowTimerPanel) return;
    if (!document.getElementById("wzq-workflow-timer-style")) {
        const style = document.createElement("link");
        style.id = "wzq-workflow-timer-style";
        style.rel = "stylesheet";
        style.href = new URL("./workflow_timer.css", import.meta.url).href;
        document.head.append(style);
    }
    node._wzqWorkflowTimerPanel = new WorkflowTimerPanel(node);
}

app.registerExtension({
    name: "wzq.workflow_timer",
    setup() {
        const originalQueuePrompt = api.queuePrompt;
        api.queuePrompt = async function (...args) {
            const ids = timerIds(args[1]?.workflow);
            if (!ids.length) return originalQueuePrompt.apply(this, args);
            submitting += 1;
            try {
                const result = await originalQueuePrompt.apply(this, args);
                if (result.prompt_id) {
                    jobs.set(result.prompt_id, { ids, started: false });
                    const events = earlyEvents.get(result.prompt_id) || [];
                    earlyEvents.delete(result.prompt_id);
                    for (const event of events) handleExecution(event.type, event.detail, event.receivedAt);
                }
                return result;
            } finally {
                submitting -= 1;
                if (!submitting) earlyEvents.clear();
                pruneStates();
            }
        };
        for (const type of ["execution_start", "execution_success", "execution_error", "execution_interrupted"]) {
            api.addEventListener(type, event => handleExecution(type, event.detail));
        }
        api.addEventListener("reconnecting", () => {
            for (const [id, state] of states) {
                if (state.status !== "running") continue;
                state.elapsed = elapsedTime(state);
                state.status = "disconnected";
                refresh(id);
            }
            updateTicker();
        });
        api.addEventListener("reconnected", recoverDisconnectedJobs);
        api.addEventListener("status", event => {
            if (event.detail?.exec_info?.queue_remaining !== 0) return;
            for (const [promptId, job] of jobs) if (!job.started) jobs.delete(promptId);
            pruneStates();
        });
    },
    beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== NODE_NAME) return;
        const created = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const result = created?.apply(this, arguments);
            attachPanel(this);
            return result;
        };
        const configured = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function () {
            const result = configured?.apply(this, arguments);
            this._wzqWorkflowTimerPanel?.bind();
            return result;
        };
        const removed = nodeType.prototype.onRemoved;
        nodeType.prototype.onRemoved = function () {
            this._wzqWorkflowTimerPanel?.destroy();
            return removed?.apply(this, arguments);
        };
    },
    nodeCreated(node) {
        if ((node.comfyClass || node.type) === NODE_NAME) attachPanel(node);
    },
});
