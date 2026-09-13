import { rgthreeApi } from "./rgthree_api.js";
// 用根路径绝对导入，避免依赖本文件在 /extensions/... 下的层级。
// 实测（真实服务器）：/scripts/api.js = 200；而 WEB_DIRECTORY 被挂载为
// /extensions/wzq_test_node/（URL 中不含 js/），因此本文件的任何相对 ../ 路径
// 都落到 /extensions/... 下并 404，会连带整条 lorainfo 模块链一起失败。
import { api } from "/scripts/api.js";

class BaseModelInfoService extends EventTarget {
    constructor() {
        super();
        this.fileToInfo = new Map();
        this.init();
    }

    init() {
        api.addEventListener(this.apiRefreshEventString, this.handleAsyncUpdate.bind(this));
    }

    async getInfo(file, refresh, light) {
        if (this.fileToInfo.has(file) && !refresh) {
            return this.fileToInfo.get(file);
        }
        return this.fetchInfo(file, refresh, light);
    }

    async refreshInfo(file) {
        return this.fetchInfo(file, true);
    }

    async clearFetchedInfo(file) {
        await rgthreeApi.clearModelsInfo({ type: this.modelInfoType, files: [file] });
        this.fileToInfo.delete(file);
        return null;
    }

    async savePartialInfo(file, data) {
        let info = await rgthreeApi.saveModelInfo(this.modelInfoType, file, data);
        this.fileToInfo.set(file, info);
        return info;
    }

    handleAsyncUpdate(event) {
        var _a;
        const info = (_a = event.detail) === null || _a === void 0 ? void 0 : _a.data;
        if (info === null || info === void 0 ? void 0 : info.file) {
            this.setFreshInfo(info.file, info);
        }
    }

    async fetchInfo(file, refresh = false, light = false) {
        var _a;
        let info = null;
        if (!refresh) {
            info = await rgthreeApi.getModelsInfo({ type: this.modelInfoType, files: [file], light });
        }
        else {
            info = await rgthreeApi.refreshModelsInfo({ type: this.modelInfoType, files: [file] });
        }
        info = (_a = info === null || info === void 0 ? void 0 : info[0]) !== null && _a !== void 0 ? _a : null;
        if (!light) {
            this.fileToInfo.set(file, info);
        }
        return info;
    }

    setFreshInfo(file, info) {
        this.fileToInfo.set(file, info);
    }
}

class LoraInfoService extends BaseModelInfoService {
    constructor() {
        super(...arguments);
        this.apiRefreshEventString = "rgthree-refreshed-loras-info";
        this.modelInfoType = 'loras';
    }
}

class CheckpointInfoService extends BaseModelInfoService {
    constructor() {
        super(...arguments);
        this.apiRefreshEventString = "rgthree-refreshed-checkpoints-info";
        this.modelInfoType = 'checkpoints';
    }
}

export const LORA_INFO_SERVICE = new LoraInfoService();
export const CHECKPOINT_INFO_SERVICE = new CheckpointInfoService();
