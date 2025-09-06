import torch
import threading
import comfy.utils

# 全局内存缓存
class ImageCache:
    _instance = None
    _lock = threading.Lock()
    
    def __new__(cls):
        with cls._lock:
            if cls._instance is None:
                cls._instance = super().__new__(cls)
                cls._instance.cache = {}
            return cls._instance
    
    def store(self, key, images):
        """存储张量图像到缓存"""
        with self._lock:
            self.cache[key] = [img.cpu().clone() for img in images]
    
    def retrieve(self, key):
        """从缓存检索图像"""
        with self._lock:
            if key == "":
                # 返回整个缓存的所有图像（合并成一个列表）
                result = []
                for img_list in self.cache.values():
                    result.extend([img.clone() for img in img_list])
                return result
            return [img.clone() for img in self.cache.get(key, [])]
    
    def clear(self, key=None):
        """清除特定键或所有缓存"""
        with self._lock:
            if key:
                if key in self.cache:
                    del self.cache[key]
            else:
                self.cache.clear()
    
    def count(self, key):
        """计算特定键或整个缓存的图像数量"""
        with self._lock:
            if key == "":
                # 整个缓存的图像总数
                cur_count = sum(len(imgs) for imgs in self.cache.values())
                # print(f"  存储图像数量: {cur_count} 张")
                return cur_count
            else:
                return len(self.cache.get(key, []))

# ComfyUI节点实现
class ImageCacheNode:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "mode": (["store", "retrieve", "clear"], {"default": "store"}),
                "cache_key": ("STRING", {"default": "default"}),
            },
            "optional": {
                "images": ("IMAGE",),
            }
        }
    
    RETURN_TYPES = ("IMAGE", "INT")
    RETURN_NAMES = ("images", "image_count")
    OUTPUT_IS_LIST = (True, False)
    FUNCTION = "manage_cache"
    CATEGORY = "image/utils"

    def manage_cache(self, mode, cache_key, images=None):
        cache = ImageCache()
        
        if mode == "store":
            if images is None:
                raise ValueError("需要提供图像进行存储")
            # 转换为列表形式存储
            if not isinstance(images, list):
                images = [images]
            cache.store(cache_key, images)
            image_count = len(images)
            return (images, image_count)
        
        elif mode == "retrieve":
            cached = cache.retrieve(cache_key)
            image_count = cache.count(cache_key)
            
            # 空键检索整个缓存时不检查是否为空
            if cache_key != "" and not cached:
                raise ValueError(f"缓存中找不到键: {cache_key}")
                
            # 处理空列表问题：当没有图像时返回虚拟图像
            if len(cached) == 0:
                dummy_image = torch.zeros(1, 1, 1, 3)  # 1x1黑色图像
                return ([dummy_image], 0)
                
            return (cached, image_count)
        
        elif mode == "clear":
            cache.clear(cache_key if cache_key != "__ALL__" else None)
            # 返回虚拟图像和计数0
            dummy_image = torch.zeros(1, 1, 1, 3)  # 1x1黑色图像
            return ([dummy_image], 0)
        
        # 默认返回虚拟图像
        dummy_image = torch.zeros(1, 1, 1, 3)
        return ([dummy_image], 0)

