# python3 whiten.py <in.png> <out.png> [crop x0 y0 x1 y1 as fractions]
# the white-studio render's background brought to the slide's #fcfcfc; shadows and the objects keep their tones
import sys
import numpy as np
from PIL import Image
src, out = sys.argv[1:3]
im = Image.open(src).convert('RGB')
if len(sys.argv) > 3:
    W, H = im.size; f = [float(v) for v in sys.argv[3:7]]
    im = im.crop((int(W * f[0]), int(H * f[1]), int(W * f[2]), int(H * f[3])))
a = np.asarray(im).astype(np.float32)
c = np.concatenate([a[:30, :30].reshape(-1, 3), a[:30, -30:].reshape(-1, 3)])
bg = np.median(c, axis=0).mean()
a = np.clip(a * (252.0 / bg), 0, 255)
lum = a.mean(axis=2, keepdims=True); t = np.clip((lum - 240) / (251 - 240), 0, 1)
a = a * (1 - t) + 252 * t
Image.fromarray(a.astype(np.uint8)).save(out, optimize=True)
print(out.split('/')[-1], im.size, 'bg', round(float(bg), 1))
# feather: the outer band fades into the background so no rectangle shows
im2 = Image.open(out).convert('RGB'); w, h = im2.size; a2 = np.asarray(im2).astype(np.float32)
fx = np.clip(np.minimum(np.arange(w), np.arange(w)[::-1]) / (w * 0.07), 0, 1); fy = np.clip(np.minimum(np.arange(h), np.arange(h)[::-1]) / (h * 0.07), 0, 1)
m = (np.minimum.outer(fy, fx) ** 1.5)[..., None]
a2 = a2 * m + 252 * (1 - m)
Image.fromarray(a2.astype(np.uint8)).save(out, optimize=True)
