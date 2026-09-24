# Vendored VideoHelperSuite code

`vhs_compat` is a source copy of the VideoHelperSuite Python implementation,
adapted only to let `Video Combine 🎥🅥🅗🅢 V2` run without a separate
VideoHelperSuite installation.  Its original project is:

https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite

The copied code is distributed under GNU GPL v3.0. See `LICENSE` in this
directory.

Changes inherited from FeiHou Toolbox: the vendored preview endpoints use a
private prefix, preventing conflicts when VideoHelperSuite is also installed.
This WZQ adaptation changes that prefix to `/wzq-vhs/` so it can coexist with
both VideoHelperSuite and FeiHou Toolbox.
