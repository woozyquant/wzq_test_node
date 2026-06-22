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
    CATEGORY = 'test_nodes📀/wzq'

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
        
class ImageTileBatch:
    def __init__(self):
        pass

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "num_tiles": ("INT", {"default":4, "max": 64, "min":2, "step":1}),
            }
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("IMAGES",)
    FUNCTION = "tile_image"

    CATEGORY = "test_nodes📀/wzq"

    def tile_image(self, image, num_tiles=6):
        image = tensor2pil(image.squeeze(0))
        img_width, img_height = image.size

        num_rows = int(num_tiles ** 0.5)
        num_cols = (num_tiles + num_rows - 1) // num_rows
        tile_width = img_width // num_cols
        tile_height = img_height // num_rows

        tiles = []
        for y in range(0, img_height, tile_height):
            for x in range(0, img_width, tile_width):
                tile = image.crop((x, y, x + tile_width, y + tile_height))
                tiles.append(pil2tensor(tile))

        tiles = torch.stack(tiles, dim=0).squeeze(1)

        return (tiles, )

#NODE_CLASS_MAPPINGS = {
#    "ImageResizer": ImageResizer,
#}

#NODE_DISPLAY_NAME_MAPPINGS = {
#    "ImageResizer": "🖼️Image Resizer"
#}
