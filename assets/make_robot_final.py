from pathlib import Path
import numpy as np
import cv2
from PIL import Image, ImageFilter
import imageio.v2 as imageio

src = Path(r'C:\Users\rojin\Downloads\Telegram Desktop\IMG_0818 (2).MP4')
out = Path(r'C:\HTML UIUX\E4la\assets\robot_final.webm')
preview_dir = Path(r'C:\HTML UIUX\E4la\assets\robot_final_preview')
preview_dir.mkdir(parents=True, exist_ok=True)

sr = cv2.dnn_superres.DnnSuperResImpl_create()
sr.readModel(str(Path(r'C:\HTML UIUX\E4la\assets\sr_models\FSRCNN_x2.pb')))
sr.setModel('fsrcnn', 2)

reader = imageio.get_reader(str(src), 'ffmpeg')
meta = reader.get_meta_data()
fps = float(meta.get('fps', 24))

BG = np.array([2.0, 2.0, 4.0])
LO, HI = 96, 150

def make_mask(rgb):
    arr = rgb.astype(np.int16)
    mx = arr.max(axis=2)
    mn = arr.min(axis=2)
    sat = mx - mn
    seed = ((mx > 60) | ((sat > 26) & (mx > 30)) | ((sat > 38) & (mx > 20)))
    m = Image.fromarray((seed * 255).astype(np.uint8), 'L')
    m = m.filter(ImageFilter.MaxFilter(5))
    m = m.filter(ImageFilter.MinFilter(5))
    return np.array(m) > 0

prev_mask = None
frames_rgba = []
for i, frame in enumerate(reader):
    rgb = frame[:, :, :3].astype(np.uint8)
    mask = make_mask(rgb)
    if prev_mask is not None:
        # Temporal smoothing: keep a previous-frame edge pixel alive for one
        # extra frame if it's still adjacent to the current detection, so a
        # single noisy frame doesn't pop a ring of pixels in/out — that
        # frame-to-frame jitter is what reads as a "shimmering halo" during
        # playback even when any single still frame looks clean on its own.
        # Pixels the current frame no longer detects ANYWHERE nearby are
        # still dropped, so the mask can't drift or accumulate over time.
        mask_dilated = np.array(
            Image.fromarray((mask * 255).astype(np.uint8), 'L').filter(ImageFilter.MaxFilter(3))
        ) > 0
        mask = mask | (prev_mask & mask_dilated)
    prev_mask = mask

    alpha = Image.fromarray((mask * 255).astype(np.uint8), 'L').filter(ImageFilter.GaussianBlur(0.4))
    a = np.array(alpha).astype(np.float32)
    a[a < LO] = 0
    mid = (a >= LO) & (a < HI)
    a[mid] = (a[mid] - LO) * 255 / (HI - LO)
    a = np.clip(a, 0, 255)

    a_norm = (a / 255.0)[..., None]
    a_safe = np.clip(a_norm, 0.12, 1.0)
    fg = (rgb.astype(np.float32) - (1 - a_safe) * BG) / a_safe
    fg = np.clip(fg, 0, 255)
    ring = (a > 0) & (a < 255)
    rgb2 = rgb.astype(np.float32).copy()
    rgb2[ring] = fg[ring]
    rgb2 = np.clip(rgb2, 0, 255).astype(np.uint8)
    rgb2[a < 2] = 0

    # Super-resolve the color plate 2x (BGR order for cv2), upscale alpha
    # with a plain high-quality resize (a learned RGB model isn't meaningful
    # on a single soft mask channel) then re-feather 1 hi-res px so the edge
    # doesn't turn jagged after the resize.
    bgr = cv2.cvtColor(rgb2, cv2.COLOR_RGB2BGR)
    bgr_sr = sr.upsample(bgr)
    rgb_sr = cv2.cvtColor(bgr_sr, cv2.COLOR_BGR2RGB)
    h2, w2 = rgb_sr.shape[:2]
    a_img = Image.fromarray(a.astype(np.uint8), 'L').resize((w2, h2), Image.LANCZOS)
    a_img = a_img.filter(ImageFilter.GaussianBlur(0.5))
    a_sr = np.array(a_img)

    rgba = np.dstack([rgb_sr, a_sr])
    if i in (0, 24, 48, 72, 96, 120):
        Image.fromarray(rgba, 'RGBA').save(preview_dir / f'frame_{i:03d}.png')
    frames_rgba.append(rgba)
    if i % 20 == 0:
        print('processed', i)

reader.close()

writer = imageio.get_writer(
    str(out), format='FFMPEG', mode='I', fps=fps, codec='libvpx-vp9',
    pixelformat='yuva420p', macro_block_size=1,
    output_params=['-auto-alt-ref', '0', '-b:v', '0', '-crf', '20']
)
for rgba in frames_rgba:
    writer.append_data(rgba)
writer.close()
print('written', out)
