from pathlib import Path
from collections import deque
import numpy as np
from PIL import Image, ImageFilter, ImageEnhance
import imageio.v2 as imageio

src = Path(r'C:\Users\rojin\Downloads\Telegram Desktop\IMG_0818 (2).MP4')
out = Path(r'C:\HTML UIUX\E4la\assets\robot_0818_2_clean_alpha.webm')
preview_dir = Path(r'C:\HTML UIUX\E4la\assets\robot_0818_2_alpha_preview')
preview_dir.mkdir(parents=True, exist_ok=True)

reader = imageio.get_reader(str(src), 'ffmpeg')
meta = reader.get_meta_data()
fps = float(meta.get('fps', 24))

# Conservative segmentation: keep colored/bright robot detail, then expand and fill
# enclosed dark regions so the robot body is protected from background removal.
def fill_holes(mask):
    h, w = mask.shape
    inv = ~mask
    seen = np.zeros_like(inv, dtype=bool)
    q = deque()
    for x in range(w):
        if inv[0, x]:
            seen[0, x] = True; q.append((0, x))
        if inv[h-1, x] and not seen[h-1, x]:
            seen[h-1, x] = True; q.append((h-1, x))
    for y in range(h):
        if inv[y, 0] and not seen[y, 0]:
            seen[y, 0] = True; q.append((y, 0))
        if inv[y, w-1] and not seen[y, w-1]:
            seen[y, w-1] = True; q.append((y, w-1))
    while q:
        y, x = q.popleft()
        ny = y - 1
        if ny >= 0 and inv[ny, x] and not seen[ny, x]:
            seen[ny, x] = True; q.append((ny, x))
        ny = y + 1
        if ny < h and inv[ny, x] and not seen[ny, x]:
            seen[ny, x] = True; q.append((ny, x))
        nx = x - 1
        if nx >= 0 and inv[y, nx] and not seen[y, nx]:
            seen[y, nx] = True; q.append((y, nx))
        nx = x + 1
        if nx < w and inv[y, nx] and not seen[y, nx]:
            seen[y, nx] = True; q.append((y, nx))
    holes = inv & ~seen
    return mask | holes

writer = imageio.get_writer(
    str(out),
    format='FFMPEG',
    mode='I',
    fps=fps,
    codec='libvpx-vp9',
    pixelformat='yuva420p',
    macro_block_size=1,
    output_params=['-auto-alt-ref', '0', '-b:v', '0', '-crf', '26']
)

saved = 0
count = 0
for i, frame in enumerate(reader):
    rgb = frame[:, :, :3].astype(np.uint8)
    arr = rgb.astype(np.int16)
    mx = arr.max(axis=2)
    mn = arr.min(axis=2)
    sat = mx - mn

    # Background is near black/neutral; robot has saturated neon edges plus bright metal.
    fg = ((mx > 52) | ((sat > 22) & (mx > 24)) | ((mx > 34) & (sat > 14)))

    # Remove tiny background specks, then grow enough to protect the dark body interior.
    m = Image.fromarray((fg * 255).astype(np.uint8), 'L')
    m = m.filter(ImageFilter.MaxFilter(17))
    m = m.filter(ImageFilter.MinFilter(5))
    m = m.filter(ImageFilter.MaxFilter(11))
    mask = np.array(m) > 0
    mask = fill_holes(mask)

    # Smooth/feather the alpha so edges do not look bitten or crunchy.
    alpha = Image.fromarray((mask * 255).astype(np.uint8), 'L')
    alpha = alpha.filter(ImageFilter.GaussianBlur(1.25))
    alpha_np = np.array(alpha).astype(np.uint8)

    img = Image.fromarray(rgb, 'RGB')
    img = ImageEnhance.Color(img).enhance(1.08)
    img = ImageEnhance.Contrast(img).enhance(1.06)
    img = ImageEnhance.Sharpness(img).enhance(1.08)
    rgb2 = np.array(img).astype(np.uint8)
    rgb2[alpha_np < 4] = 0
    rgba = np.dstack([rgb2, alpha_np])

    if i in (0, 24, 48, 72, 96):
        Image.fromarray(rgba, 'RGBA').save(preview_dir / f'preview_{i:03d}.png')
        saved += 1

    writer.append_data(rgba)
    count += 1

writer.close()
reader.close()
print('written', out, 'frames', count, 'fps', fps, 'previews', saved)
