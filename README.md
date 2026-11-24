# babsim-scanner-render

Path-traced product renders of the Bapshim scanner — the tray-return station that weighs leftovers with four
load cells and photographs the tray from above. The model is built from primitives in three.js and rendered with
[three-gpu-pathtracer](https://github.com/gkjohnson/three-gpu-pathtracer) in headless Chrome.

| File | What it is |
|---|---|
| `render.html` | The mobile kiosk: casters, stainless deck with four bar load cells, back panel with a result screen, canopy with camera, ring light, diffusers and NIR LEDs; student-ID reader; controller. Also a tray-only scene. |
| `render-arm.html` | The countertop variant: base with load cells, column and arm with the camera head. |
| `render-node.mjs` | Node driver (Windows / any OS with a GPU). Serves the folder, opens the page, waits, writes the PNG and the projected anchor points. |
| `render.ts`, `gpu-cdp.ts` | The same driver for Bun on macOS. |
| `whiten.py` | Brings a white-studio render's background to the slide colour and feathers the edges. |
| `babsim.svg` | The logo drawn on the canopy and the result screen. |

## Run

```sh
# path trace, 1024 samples per pixel, 1400×1820, the hero view
node render-node.mjs pt 1024 hero.png 1400 1820 1 "view=hero&fov=32&exp=1.15"
# the tray alone, on a white studio
node render-node.mjs pt 768 tray.png 1400 1000 1 "view=tray&fov=34&only=tray&white=1"
# the countertop variant
node render-node.mjs pt 1024 arm.png 1400 1100 1 "view=hero&fov=25&exp=1.15" render-arm.html
# a quick raster preview (seconds), or only the anchor points
node render-node.mjs raster 1 preview.png 1400 1820 1 "view=hero&fov=32"
node render-node.mjs anchors 1 a.png 1400 1820 1 "view=hero&fov=32"
```

Query parameters: `mode` (`raster` · `pt` · `anchors`), `spp`, `view` (`hero` · `under` · `cell` · `front` · `tray`),
`fov`, `exp` (exposure), `only=tray`, `white=1` (white studio). Units in the scene are millimetres.

Each run also writes `<out>.anchors.json`: the screen position of named parts (canopy, screen, load cells,
reader, controller, lens …), used to draw leader lines next to the render.

Chrome is started with the GPU on (`--use-angle=d3d11 --force_high_performance_gpu` on Windows,
`--use-angle=metal` on macOS). On a dual-GPU machine the WebGL context sometimes comes up lost; the Node driver
reopens the page when that happens. three.js 0.170, three-mesh-bvh 0.8.3 and three-gpu-pathtracer 0.0.23 load
from jsDelivr.
