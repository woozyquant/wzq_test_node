import torch
import random
import datetime
import comfy.model_management

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
    RETURN_TYPES = ("STRING","STRING","INT", "FLOAT", "INT", "INT", "INT", "STRING")
    # 自定义输出名称
    RETURN_NAMES = ("pos_str","neg_str","steps","cfg","seed", "width", "height","all")

    FUNCTION = "test"
    def test(self,string,):
        lines = string.split('\n')
        lines = [line.rstrip('\r') for line in lines if line]
        sample = ""
        pos_str = ""
        neg_str = ""
        for line in lines:
            if line.startswith("Steps:"):
                sample = line
                continue
            if len(pos_str) == 0:
                pos_str = line
                continue
            if len(neg_str) == 0:
                neg_str = line
        neg_str = remove_prefix(neg_str, "Negative prompt:")
        dict = parse_string_to_dict(sample)
        steps = int(dict.get('Steps', '30'))
        cfg = float(dict.get('CFG scale', '7.0'))
        seed = int(dict.get('Seed', '0'))
        if seed == 0:
            seed = random.randint(0, 0xffffffffffffffff)
        size = dict.get('Size', '512x512')
        wh = size.split('x')
        width = int(safe_get_item(wh, 0, '512'))
        height = int(safe_get_item(wh, 1, '512'))
        text_list = '\n'.join(f"{key}: {value}" for key, value in dict.items())
        # 5输出===========================================================================
        return (pos_str, neg_str, steps, cfg, seed, width, height, text_list)


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

  RETURN_TYPES = ("INT", "INT")
  RETURN_NAMES = ("width_int", "height_int")
  OUTPUT_NODE = True
  FUNCTION = "image_width_height"

  CATEGORY = "test_nodes📀/wzq"

  def image_width_height(self, image):
    _, raw_H, raw_W, _ = image.shape

    width = raw_W
    height = raw_H

    if width is not None and height is not None:
      result = (width, height)
    else:
      result = (0, 0)
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