import os
import json
import folder_paths
import comfy.utils
import comfy.sd

class MyLoraLoaderModelOnly:
    def __init__(self):
        # 初始化缓存，避免重复读取硬盘上的 LoRA 文件
        self.loaded_lora = None

    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "model": ("MODEL",),
                "lora_name": (folder_paths.get_filename_list("loras"), ),
                "strength_model": ("FLOAT", {"default": 1.0, "min": -20.0, "max": 20.0, "step": 0.01}),
            }
        }

    RETURN_TYPES = ("MODEL",)
    RETURN_NAMES = ("MODEL",)
    FUNCTION = "apply_lora_model_only"
    CATEGORY = "test_nodes📀/wzq"  # 节点在菜单中显示的位置

    def apply_lora_model_only(self, model, lora_name, strength_model):
        # 1. 如果强度为0，直接返回原模型，不做任何处理
        if strength_model == 0:
            return (model,)

        # 2. 获取 LoRA 文件的绝对路径
        lora_path = folder_paths.get_full_path("loras", lora_name)
        lora = None

        # 3. 简单的缓存逻辑：如果加载的文件和上次一样，就直接用内存里的
        if self.loaded_lora is not None:
            if self.loaded_lora[0] == lora_path:
                lora = self.loaded_lora[1]
            else:
                self.loaded_lora = None

        # 4. 如果没命中缓存，从硬盘加载
        if lora is None:
            lora = comfy.utils.load_torch_file(lora_path, safe_load=True)
            self.loaded_lora = (lora_path, lora)

        # 5. 核心逻辑：调用 ComfyUI 内部函数
        # 参数顺序：model, clip, lora, strength_model, strength_clip
        # 我们这里把 clip 设为 None，strength_clip 设为 0
        model_lora, _ = comfy.sd.load_lora_for_models(model, None, lora, strength_model, 0)

        return (model_lora,)
    
class AnyType111(str):
    def __ne__(self, __value: object) -> bool:
        return False

ANY111 = AnyType111("*")    

class MyLocalLoraOnlyGallery:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "hidden": {
                "unique_id": "UNIQUE_ID",
                "selection_data": ("STRING", {"default": "[]", "multiline": True, "forceInput": True})
            }
        }

    RETURN_TYPES = (ANY111,)
    RETURN_NAMES = ("loraName",)

    FUNCTION = "load_loras"
    CATEGORY = "test_nodes📀/wzq"
    OUTPUT_NODE = True

    def load_loras(self, unique_id, selection_data="[]", **kwargs):
        try:
            lora_configs = json.loads(selection_data)
        except:
            lora_configs = []
        lora_name = ""
        for config in lora_configs:
            if not config.get('on', True) or not config.get('lora'):
                continue
            lora_name = config['lora']
        return (lora_name,)

