"""Workflow timing is displayed by the frontend execution-event listener."""

from . import categories


class WZQWorkflowTimer:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {}}

    RETURN_TYPES = ()
    FUNCTION = "execute"
    CATEGORY = categories.TOOLS
    DESCRIPTION = "无需连线。工作流开始执行时计时，完成、失败或中断时停止；不包含排队等待时间。"

    def execute(self):
        return ()
