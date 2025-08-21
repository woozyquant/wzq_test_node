from nodes import MAX_RESOLUTION
import json
import os
import torch
import random
import datetime
import re
import comfy.model_management
import comfy.samplers

MAX_SEED_NUM = 1125899906842624


def safe_get_item(lst, index, default):  
    return lst[index] if 0 <= index < len(lst) else default

def remove_prefix(s, prefix):  
    if s.startswith(prefix):  
        return s[len(prefix):]  
    return s

def parse_string_to_dict(s):  
    pairs = s.split(',')  
    result = {}  
    for pair in pairs:  
        pair = pair.strip()  
        if ':' in pair:
            key, value = pair.split(':', 1)  
            key, value = key.strip(), value.strip()  
            result[key] = value  
    return result  


class mySplit:
    def __init__(self):
        pass
    CATEGORY = "test_nodes📀/wzq"

    SAMPLER_TYPE = comfy.samplers.KSampler.SAMPLERS

    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "string": ("STRING", {
                    "default": "",  # 默认内容
                    "multiline": True}),  # 是否允许多行输入
            },
        }

    OUTPUT_NODE = True
    # 输出的数据类型，需要大写
    RETURN_TYPES = ("STRING","STRING","INT", "FLOAT", "INT", "INT", "INT", SAMPLER_TYPE, "STRING", "STRING")
    # 自定义输出名称
    RETURN_NAMES = ("pos_str","neg_str","steps","cfg","seed", "width", "height","sampler_name","All","Loras")


    def match_sampler(self, sampler_name_str):
        clean_input = sampler_name_str.strip().lower().replace(' ', '_')
        if not clean_input:
            return "euler"
        sampler_list = self.SAMPLER_TYPE
        if clean_input in sampler_list:
            return clean_input
        matches = [s for s in sampler_list if s.startswith(clean_input)]
        if len(matches) == 1:
            # 找到唯一匹配
            found_sampler = matches[0]
            return found_sampler       
        elif len(matches) > 1:
            # 找到多个匹配，选择最短的作为最佳匹配
            matches.sort(key=len) # 按长度升序排序
            best_match = matches[0]
            return best_match
        else: # len(matches) == 0
            # 没有任何匹配
            return "euler"


    FUNCTION = "test"
    def test(self,string,):
        lines = string.split('\n')
        lines = [line.rstrip('\r') for line in lines if line]
        sample = ""
        pos_str = ""
        neg_str = ""
        pattern = r'<(.+?)>'
        for line in lines:
            if line.startswith("Steps:"):
                sample = line
                continue
            if line.startswith("Negative prompt:"):
                neg_str = line
                continue 
            else:
                pos_str += line + "\n"
                continue

        loras_string = '\n'.join(re.findall(pattern, pos_str))
        pos_str = re.sub(pattern, '', pos_str)
        neg_str = remove_prefix(neg_str, "Negative prompt:")
        dict = parse_string_to_dict(sample)
        steps = int(dict.get('Steps', '30'))
        cfg = float(dict.get('CFG scale', '7.0'))
        seed = int(dict.get('Seed', '0'))
        samplername = dict.get('Sampler', 'Euler a')
        samplername = self.match_sampler(samplername)
        if seed == 0:
            seed = random.randint(0, 0xffffffffffffffff)
        size = dict.get('Size', '512x512')
        wh = size.split('x')
        width = int(safe_get_item(wh, 0, '512'))
        height = int(safe_get_item(wh, 1, '512'))
        text_list = ""
        #text_list = '\n'.join(f"{key}: {value}" for key, value in dict.items())
        text_list += "\n\n-------------------------"
        text_list += "\nPositive prompt: " + pos_str.strip() + "\n"
        text_list += "\nNegative prompt: " + neg_str.strip() + "\n"
        text_list += "\nSteps: " + str(steps)
        text_list += "\nCFG scale: " + str(cfg)
        text_list += "\nSeed: " + str(seed)
        text_list += "\nSize: " + str(width) + "x" + str(height)
        text_list += "\nSampler: " + samplername        

        # 5输出===========================================================================
        return (pos_str, neg_str, steps, cfg, seed, width, height, samplername, text_list, loras_string)


# #################################################################################
class AnyType1(str):
    def __ne__(self, __value: object) -> bool:
        return False


# Our any instance wants to be a wildcard string
any_ = AnyType1("*")

# #################################################################################
class myReroute:
    def __init__(self):
        pass
    CATEGORY = "test_nodes📀/wzq"
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {"value": (any_, )},
        }

    @classmethod
    def VALIDATE_INPUTS(s, **kwargs):
        return True

    RETURN_TYPES = (any_,)
    FUNCTION = "route"
    #CATEGORY = "__hidden__"

    def route(self, value):
        return (value,)
        
 # #################################################################################       
class myReroute3:
    def __init__(self):
        pass
    CATEGORY = "test_nodes📀/wzq"
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {"value1": (any_, ),},
            "optional": {"value2": (any_, ), "value3": (any_, ),},
        }

    @classmethod
    def VALIDATE_INPUTS(s, **kwargs):
        return True

    RETURN_TYPES = (any_, any_, any_)
    RETURN_NAMES = ("value1", "value2", "value3")
    FUNCTION = "route"
    #CATEGORY = "__hidden__"

    def route(self, value1, value2=None, value3=None):
        return (value1,value2,value3)
        
# #################################################################################        
class myReroutexxx:
    def __init__(self):
        pass
    CATEGORY = "test_nodes📀/wzq"
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {"model": ("MODEL",),"vae": ("VAE",),"clip": ("CLIP",),},
        }

    @classmethod
    def VALIDATE_INPUTS(s, **kwargs):
        return True

    RETURN_TYPES = ("MODEL","VAE", "CLIP")
    RETURN_NAMES = ("model","vae", "clip")
    FUNCTION = "route"
    CATEGORY = "test_nodes📀/wzq"

    def route(self, model, vae, clip):
        return (model, vae, clip)

# #################################################################################  
class myImageSize:
  def __init__(self):
    pass

  @classmethod
  def INPUT_TYPES(cls):
    return {
      "required": {
        "image": ("IMAGE",),
      }
    }

  RETURN_TYPES = ("IMAGE", "INT", "INT")
  RETURN_NAMES = ("image", "width_int", "height_int")
  OUTPUT_NODE = True
  FUNCTION = "image_width_height"

  CATEGORY = "test_nodes📀/wzq"

  def image_width_height(self, image):
    _, raw_H, raw_W, _ = image.shape

    width = raw_W
    height = raw_H

    if width is not None and height is not None:
      result = (image, width, height)
    else:
      result = (image, 0, 0)
    return {"ui": {"text": "Width: "+str(width)+" , Height: "+str(height)}, "result": result}

# #################################################################################  
    # 随机种
class myEasySeed:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "seed": ("INT", {"default": 777, "min": 0, "max": MAX_SEED_NUM}),
            },
            "hidden": {"prompt": "PROMPT", "extra_pnginfo": "EXTRA_PNGINFO", "my_unique_id": "UNIQUE_ID"},
        }

    RETURN_TYPES = ("INT",)
    RETURN_NAMES = ("seed",)
    FUNCTION = "doit"

    CATEGORY = "test_nodes📀/wzq"

    def doit(self, seed=0, prompt=None, extra_pnginfo=None, my_unique_id=None):
        return seed,


# #################################################################################

class myCurrentTime:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {"anything": (any_, )},
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("current_time",)
    OUTPUT_NODE = True
    FUNCTION = "get_current_time"

    CATEGORY = "test_nodes📀/wzq"

    def get_current_time(self, anything):
        now = datetime.datetime.now()
        current_time = now.strftime("%Y-%m-%d %H:%M:%S")
        result = (current_time,)
        return {"ui": {"text": "Current Time: " + current_time}, "result": result}

# #################################################################################
class myEmptyLatent:
    def __init__(self):
        self.device = comfy.model_management.intermediate_device()

    def load_resolutions():
        json_file_path = os.path.join(os.path.dirname(__file__), "def_resolutions.json")
        default_resolutions = [
            "512x768", "768x1024", "768x1280", "832x1216", "832x1152",
            "896x1152", "512x512", "1024x1024", "1536x1536", "1072x1920"
        ]
        print(f"read {json_file_path} resolutions...")
        try:
            with open(json_file_path, 'r', encoding='utf-8') as file:
                data = json.load(file)
                if "resolutions" in data and isinstance(data["resolutions"], list):
                    return data["resolutions"]
                else:
                    return default_resolutions        
        except FileNotFoundError:
            print(f"错误: 文件 {json_file_path} 不存在，使用默认值")
            return default_resolutions
        except json.JSONDecodeError as e:
            print(f"错误: JSON解析失败 - {e}，使用默认值")
            return default_resolutions
        except PermissionError:
            print(f"错误: 没有权限读取文件 {json_file_path}，使用默认值")
            return default_resolutions
        except Exception as e:
            print(f"错误: 读取文件时发生未知错误 - {e}，使用默认值")
            return default_resolutions

    @classmethod
    def INPUT_TYPES(s):
        res1 = s.load_resolutions()
        return {"required": {
            "resolution": (res1, {"default": "1024x1024"}),
            "batch_size": ("INT", {"default": 1, "min": 1, "max": 4096}),
            "width_override": ("INT", {"default": 0, "min": 0, "max": MAX_RESOLUTION, "step": 8}),
            "height_override": ("INT", {"default": 0, "min": 0, "max": MAX_RESOLUTION, "step": 8}),
            "swap_width_height": ("BOOLEAN", {"default": False}),
            }}

    RETURN_TYPES = ("LATENT","INT","INT",)
    RETURN_NAMES = ("LATENT","width","height",)
    FUNCTION = "execute"
    CATEGORY = "test_nodes📀/wzq"

    def execute(self, resolution, batch_size, width_override=0, height_override=0, swap_width_height=False):
        width, height = resolution.split("x")
        width = width_override if width_override > 0 else int(width)
        height = height_override if height_override > 0 else int(height)
        
        # 如果启用宽高切换，则交换宽度和高度
        if swap_width_height:
            width, height = height, width

        latent = torch.zeros([batch_size, 4, height // 8, width // 8], device=self.device)

        return ({"samples":latent}, width, height,)


# #################################################################################
class myEmptyLatentQwen:
    def __init__(self):
        self.device = comfy.model_management.intermediate_device()

    @classmethod
    def INPUT_TYPES(s):
        return {"required": {
            "resolution": (["1:1","16:9","4:3", "9:16", "3:4",], {"default": "1:1"}),
            "batch_size": ("INT", {"default": 1, "min": 1, "max": 4096}),
            "width_override": ("INT", {"default": 0, "min": 0, "max": MAX_RESOLUTION, "step": 8}),
            "height_override": ("INT", {"default": 0, "min": 0, "max": MAX_RESOLUTION, "step": 8}),
            "swap_width_height": ("BOOLEAN", {"default": False}),
            }}

    RETURN_TYPES = ("LATENT","INT","INT",)
    RETURN_NAMES = ("LATENT","width","height",)
    FUNCTION = "execute"
    CATEGORY = "test_nodes📀/wzq"

    def execute(self, resolution, batch_size, width_override=0, height_override=0, swap_width_height=False):
        width = 1328
        height = 1328

        if resolution == "1:1":
            width = 1328
            height = 1328
        elif resolution == "16:9":
            width = 1664
            height = 928
        elif resolution == "4:3":
            width = 1472
            height = 1136
        elif resolution == "9:16":
            width = 928
            height = 1664
        elif resolution == "3:4":
            width = 1136    
            height = 1472

        width = width_override if width_override > 0 else int(width)
        height = height_override if height_override > 0 else int(height)
        
        # 如果启用宽高切换，则交换宽度和高度
        if swap_width_height:
            width, height = height, width

        latent = torch.zeros([batch_size, 4, height // 8, width // 8], device=self.device)

        return ({"samples":latent}, width, height,)



# #################################################################################




