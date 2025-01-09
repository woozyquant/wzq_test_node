import cv2
import numpy as np
from PIL import Image
import torch

def pil2tensor(image: Image) -> torch.Tensor:
    return torch.from_numpy(np.array(image).astype(np.float32) / 255.0).unsqueeze(0)

def tensor2pil(t_image: torch.Tensor) -> Image:
    return Image.fromarray(np.clip(255.0 * t_image.cpu().numpy().squeeze(), 0, 255).astype(np.uint8))

class ImageResizer:
    def __init__(self):
        pass

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image_a": ("IMAGE",),
                "image_b": ("IMAGE",),
            },
            "optional": {}
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("resized_image",)
    FUNCTION = 'resize_image'
    CATEGORY = 'Image Processing'

    def resize_image(self, image_a, image_b):
        ret_images = []
        
        for i_a, i_b in zip(image_a, image_b):
            # Convert tensors to PIL for processing
            pil_a = tensor2pil(torch.unsqueeze(i_a, 0)).convert('RGB')
            pil_b = tensor2pil(torch.unsqueeze(i_b, 0)).convert('RGB')
            
            # Get target size from image_b
            target_size = pil_b.size
            
            # Resize image_a to the target size using Lanczos algorithm
            resized_pil_a = pil_a.resize(target_size, Image.LANCZOS)
            
            # Convert resized PIL image back to tensor
            resized_tensor_a = pil2tensor(resized_pil_a)
            ret_images.append(resized_tensor_a)
        
        return (torch.cat(ret_images, dim=0),)

#NODE_CLASS_MAPPINGS = {
#    "ImageResizer": ImageResizer,
#}

#NODE_DISPLAY_NAME_MAPPINGS = {
#    "ImageResizer": "🖼️Image Resizer"
#}
