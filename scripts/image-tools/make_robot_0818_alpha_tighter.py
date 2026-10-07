from pathlib import Path
from collections import deque
import numpy as np
from PIL import Image, ImageFilter, ImageEnhance
import imageio.v2 as imageio

src = Path(r'C:\Users\rojin\Downloads\Telegram Desktop\IMG_0818 (2).MP4')
out = Path(r'C:\HTML UIUX\E4la\assets\robot_0818_2_clean_alpha_tighter.webm')
preview_dir = Path(r'C:\HTML UIUX\E4la\assets\robot_0818_2_alpha_tighter_preview')
preview_dir.mkdir(parents=True, exist_ok=True)

reader = imageio.get_reader(str(src), 'ffmpeg')
meta = reader.get_meta_data()
fps = float(meta.get('fps', 24))

def largest_component(mask):
    h, w = mask.shape
    seen = np.zeros_like(mask, dtype=bool)
    best = []
    for yy in range(h):
        xs = np.where(mask[yy] & ~seen[yy])[0]
        for x0 in xs:
            if seen[yy, x0] or not mask[yy, x0]:
                continue
            comp = []
            q = deque([(yy, int(x0))])
            seen[yy, x0] = True
            while q:
                y, x = q.popleft(); comp.append((y, x))
                for ny, nx in ((y-1,x),(y+1,x),(y,x-1),(y,x+1)):
                    if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True; q.append((ny, nx))
            if len(comp) > len(best):
                best = comp
    out = np.zeros_like(mask, dtype=bool)
    for y, x in best:
        out[y, x] = True
    return out

def fill_holes(mask):
    h, w = mask.shape
    inv = ~mask
    seen = np.zeros_like(inv, dtype=bool)
    q = deque()
    for x in range(w):
        if inv[0, x]: seen[0, x] = True; q.append((0, x))
        if inv[h-1, x] and not seen[h-1, x]: seen[h-1, x] = True; q.append((h-1, x))
    for y in range(h):
        if inv[y, 0] and not seen[y, 0]: seen[y, 0] = True; q.append((y, 0))
        if inv[y, w-1] and not seen[y, w-1]: seen[y, w-1] = True; q.append((y, w-1))
    while q:
        y, x = q.popleft()
        for ny, nx in ((y-1,x),(y+1,x),(y,x-1),(y,x+1)):
            if 0 <= ny < h and 0 <= nx < w and inv[ny, nx] and not seen[ny, nx]:
                seen[ny, nx] = True; q.append((ny, nx))
    return mask | (inv & ~seen)

writer = imageio.get_writer(
    str(out), format='FFMPEG', mode='I', fps=fps, codec='libvpx-vp9',
    pixelformat='yuva420p', macro_block_size=1,
    output_params=['-auto-alt-ref', '0', '-b:v', '0', '-crf', '27']
)

for i, frame in enumerate(reader):
    rgb = frame[:, :, :3].astype(np.uint8)
    arr = rgb.astype(np.int16)
    mx = arr.max(axis=2)
    mn = arr.min(axis=2)
    sat = mx - mn

    # Stricter seed: robot metal/neon details only, not broad dark background glow.
    seed = ((mx > 72) | ((sat > 34) & (mx > 38)) | ((sat > 48) & (mx > 28)))
    # Remove tiny specks and keep only the main robot cluster.
    m = Image.fromarray((seed * 255).astype(np.uint8), 'L')
    m = m.filter(ImageFilter.MinFilter(3))
    m = m.filter(ImageFilter.MaxFilter(9))
    mask = np.array(m) > 0
    mask = largest_component(mask)

    # Expand just enough to protect dark body interior, then fill enclosed holes.
    m = Image.fromarray((mask * 255).astype(np.uint8), 'L')
    m = m.filter(ImageFilter.MaxFilter(7))
    m = m.filter(ImageFilter.MinFilter(3))
    mask = np.array(m) > 0
    mask = fill_holes(mask)

    # Tight edge: less feather, stronger cutoff for leftover dark rings/halo.
    alpha = Image.fromarray((mask * 255).astype(np.uint8), 'L').filter(ImageFilter.GaussianBlur(0.45))
    alpha_np = np.array(alpha).astype(np.float32)
    alpha_np[alpha_np < 112] = 0
    mid = (alpha_np >= 112) & (alpha_np < 190)
    alpha_np[mid] = (alpha_np[mid] - 112) * 255 / 78
    alpha_np = np.clip(alpha_np, 0, 255).astype(np.uint8)

    img = Image.fromarray(rgb, 'RGB')
    img = ImageEnhance.Color(img).enhance(1.08)
    img = ImageEnhance.Contrast(img).enhance(1.07)
    img = ImageEnhance.Sharpness(img).enhance(1.08)
    rgb2 = np.array(img).astype(np.uint8)
    rgb2[alpha_np < 4] = 0
    rgba = np.dstack([rgb2, alpha_np])

    if i in (0, 24, 48, 72, 96):
        Image.fromarray(rgba, 'RGBA').save(preview_dir / f'preview_{i:03d}.png')
    writer.append_data(rgba)

writer.close(); reader.close()
print('written', out)
