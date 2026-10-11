import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomFillSync } from "node:crypto";
import test from "node:test";
import vm from "node:vm";

const sourceUrl = new URL("../js/workflow_timer.js", import.meta.url);
const source = await readFile(sourceUrl, "utf8");

async function createTimerEnvironment(queuePrompt = async () => ({ prompt_id: "job-1" })) {
    class Element {
        constructor() { this.dataset = {}; this.children = new Map(); this.textContent = ""; }
        querySelector(selector) {
            if (!this.children.has(selector)) this.children.set(selector, new Element());
            return this.children.get(selector);
        }
        remove() {}
    }
    const api = new EventTarget();
    api.queuePrompt = queuePrompt;
    const styles = new Map();
    const document = {
        createElement: () => new Element(),
        getElementById: id => styles.get(id),
        head: { append: element => styles.set(element.id, element) },
    };
    const intervals = new Set();
    let now = 0;
    let extension;
    const app = { registerExtension: value => { extension = value; } };
    const context = vm.createContext({
        document, URL, Date, console, crypto: { getRandomValues: randomFillSync }, performance: { now: () => now },
        setInterval: callback => { intervals.add(callback); return callback; },
        clearInterval: callback => intervals.delete(callback),
    });
    const appModule = new vm.SyntheticModule(["app"], function () { this.setExport("app", app); }, { context });
    const apiModule = new vm.SyntheticModule(["api"], function () { this.setExport("api", api); }, { context });
    const module = new vm.SourceTextModule(source, {
        context, initializeImportMeta: meta => { meta.url = sourceUrl.href; },
    });
    await module.link(specifier => specifier === "/scripts/app.js" ? appModule : apiModule);
    await module.evaluate();
    extension.setup();

    class Node {
        constructor(properties = {}) {
            this.type = "WZQWorkflowTimer";
            this.properties = {};
            this.size = [140, 80];
            this.onNodeCreated();
            this.properties = { ...properties };
            this.onConfigure();
        }
        addDOMWidget(name, type, root, options) { this.widget = { name, type, root, options }; }
        setSize(size) { this.size = size; }
    }
    extension.beforeRegisterNodeDef(Node, { name: "WZQWorkflowTimer" });
    function emit(type, detail) {
        api.dispatchEvent(new CustomEvent(type, { detail }));
    }
    function workflow(...nodes) {
        return { nodes: nodes.map(node => ({ type: node.type, mode: node.mode || 0, properties: { ...node.properties } })) };
    }
    function text(node, field) { return node.widget.root.querySelector(`.wzq-timer-${field}`).textContent; }
    return { api, Node, emit, workflow, text, intervals, advance: milliseconds => { now += milliseconds; } };
}

test("waits for execution, uses server timestamps, and preserves the previous run", async () => {
    let job = 0;
    const env = await createTimerEnvironment(async () => ({ prompt_id: `job-${++job}` }));
    const node = new env.Node();
    assert.equal(node.isVirtualNode, true);
    assert.equal(node.widget.options.serialize, false);
    const payload = { workflow: env.workflow(node), output: {} };
    await env.api.queuePrompt(0, payload);
    env.advance(90000);
    assert.equal(env.text(node, "main"), "00:00:00");
    env.emit("execution_start", { prompt_id: "job-1", timestamp: 100000 });
    env.advance(1500);
    for (const tick of env.intervals) tick();
    assert.equal(env.text(node, "main"), "00:00:01");
    await env.api.queuePrompt(0, payload);
    assert.equal(env.text(node, "status-text"), "运行中");
    env.emit("execution_success", { prompt_id: "job-1", timestamp: 238420 });
    assert.equal(env.text(node, "main"), "00:02:18");
    assert.equal(env.text(node, "fraction"), ".42");
    assert.equal(env.intervals.size, 0);
    env.emit("execution_start", { prompt_id: "job-2", timestamp: 240000 });
    assert.equal(env.text(node, "previous"), "00:02:18.42");
    assert.equal(env.text(node, "main"), "00:00:00");
    env.emit("execution_success", { prompt_id: "job-2", timestamp: 385110 });
    assert.equal(node.properties.wzq_timer_result.elapsed, 145110);
});

test("handles a cached run finishing before the submission response", async () => {
    let resolve;
    const env = await createTimerEnvironment(() => new Promise(done => { resolve = done; }));
    const node = new env.Node();
    const queued = env.api.queuePrompt(0, { workflow: env.workflow(node), output: {} });
    env.emit("execution_start", { prompt_id: "fast", timestamp: 1000 });
    env.emit("execution_start", { prompt_id: "fast", timestamp: 1000 });
    env.emit("execution_success", { prompt_id: "fast", timestamp: 1042 });
    resolve({ prompt_id: "fast" });
    await queued;
    assert.equal(env.text(node, "status-text"), "已完成");
    assert.equal(env.text(node, "fraction"), ".04");
    assert.equal(env.intervals.size, 0);
});

test("keeps a queued run attached to its workflow across a canvas switch", async () => {
    const env = await createTimerEnvironment();
    const first = new env.Node();
    const saved = { ...first.properties };
    await env.api.queuePrompt(0, { workflow: env.workflow(first), output: {} });
    first.onRemoved();
    const otherWorkflow = new env.Node();
    env.emit("execution_start", { prompt_id: "job-1", timestamp: 2000 });
    env.emit("execution_success", { prompt_id: "job-1", timestamp: 62000 });
    assert.equal(env.text(otherWorkflow, "status-text"), "等待生成");
    const restored = new env.Node(saved);
    assert.equal(env.text(restored, "main"), "00:01:00");
    assert.equal(env.text(restored, "status-text"), "已完成");
});

test("clones have independent identities; multiple timers in a workflow update together", async () => {
    const env = await createTimerEnvironment();
    const first = new env.Node();
    const clone = new env.Node(first.properties);
    assert.notEqual(first.properties.wzq_timer_id, clone.properties.wzq_timer_id);
    await env.api.queuePrompt(0, { workflow: env.workflow(first, clone), output: {} });
    env.emit("execution_start", { prompt_id: "job-1", timestamp: 1000 });
    env.emit("execution_success", { prompt_id: "job-1", timestamp: 12000 });
    assert.equal(env.text(first, "main"), "00:00:11");
    assert.equal(env.text(clone, "main"), "00:00:11");
});

for (const [event, label] of [["execution_error", "执行失败"], ["execution_interrupted", "已中断"]]) {
    test(`${event} stops the clock and ignores unrelated broadcasts`, async () => {
        const env = await createTimerEnvironment();
        const node = new env.Node();
        await env.api.queuePrompt(0, { workflow: env.workflow(node), output: {} });
        env.emit("execution_start", { prompt_id: "job-1", timestamp: 1000 });
        env.emit(event, { prompt_id: "another-client", timestamp: 5000 });
        assert.equal(env.text(node, "status-text"), "运行中");
        env.emit(event, { prompt_id: "job-1", timestamp: 5000 });
        assert.equal(env.text(node, "status-text"), label);
        assert.equal(env.text(node, "main"), "00:00:04");
        assert.equal(env.intervals.size, 0);
    });
}

test("uses the monotonic clock when timestamps are unavailable and removes its ticker", async () => {
    const env = await createTimerEnvironment();
    const node = new env.Node();
    await env.api.queuePrompt(0, { workflow: env.workflow(node), output: {} });
    env.emit("execution_start", { prompt_id: "job-1" });
    env.advance(3600420);
    env.emit("execution_success", { prompt_id: "job-1" });
    assert.equal(env.text(node, "main"), "01:00:00");
    assert.equal(env.text(node, "fraction"), ".42");
    const loaded = await createTimerEnvironment();
    const restored = new loaded.Node(node.properties);
    assert.equal(loaded.text(restored, "main"), "01:00:00");
    node.onRemoved();
    assert.equal(env.intervals.size, 0);
});

test("a lost connection freezes the display and reconnect confirms a finished task from history", async () => {
    const env = await createTimerEnvironment();
    const node = new env.Node();
    await env.api.queuePrompt(0, { workflow: env.workflow(node), output: {} });
    env.emit("execution_start", { prompt_id: "job-1", timestamp: 1000 });
    env.advance(2000);
    env.emit("reconnecting");
    assert.equal(env.text(node, "status-text"), "连接中断 · 待确认");
    assert.equal(env.text(node, "main"), "00:00:02");
    assert.equal(env.intervals.size, 0);
    env.api.fetchApi = async url => {
        assert.equal(url, "/history/job-1");
        return { ok: true, json: async () => ({ "job-1": { status: { messages: [["execution_success", { prompt_id: "job-1", timestamp: 8000 }]] } } }) };
    };
    env.emit("reconnected");
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(env.text(node, "status-text"), "已完成");
    assert.equal(env.text(node, "main"), "00:00:07");
});

test("submission keeps arguments, results and errors, and skips muted timers", async () => {
    let call;
    const response = { prompt_id: "job-1", node_errors: {} };
    const env = await createTimerEnvironment(async function (...args) { call = { receiver: this, args }; return response; });
    const node = new env.Node();
    node.mode = 2;
    const payload = { workflow: env.workflow(node), output: { "42": { class_type: "SaveImage" } } };
    const options = { partialExecutionTargets: ["42"] };
    assert.equal(await env.api.queuePrompt(-1, payload, options), response);
    assert.equal(call.receiver, env.api);
    assert.deepEqual(call.args, [-1, payload, options]);
    env.emit("execution_start", { prompt_id: "job-1", timestamp: 1000 });
    assert.equal(env.text(node, "status-text"), "等待生成");
    const failure = new Error("validation failed");
    const failed = await createTimerEnvironment(async () => { throw failure; });
    const failedNode = new failed.Node();
    await assert.rejects(failed.api.queuePrompt(0, { workflow: failed.workflow(failedNode), output: {} }), error => error === failure);
    assert.equal(failed.text(failedNode, "status-text"), "等待生成");
    assert.equal(failed.intervals.size, 0);
});
