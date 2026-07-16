from pathlib import Path
import imageio.v3 as iio
from PIL import Image
src = Path(r'C:\Users\rojin\Downloads\Telegram Desktop\IMG_0818 (2).MP4')
out = Path(r'C:\HTML UIUX\E4la\assets\robot_original_frames')
out.mkdir(parents=True, exist_ok=True)
meta = iio.immeta(src)
print(meta)
frames = iio.imiter(src)
indices = {0, 15, 30, 45, 60, 90}
for i, frame in enumerate(frames):
    if i in indices:
        Image.fromarray(frame).save(out / f'frame_{i:03d}.png')
        print('saved', i, frame.shape)
    if i > max(indices):
        break
