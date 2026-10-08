"""Write a WebP copy beside every JPEG in public/images (about half the download).

The game loads the .webp where the browser can show it and the .jpg elsewhere
(src/game/pictures.ts), so run this again after adding or changing a picture:

    python3 scripts/make-webp.py
"""
from pathlib import Path

from PIL import Image

QUALITY = 80

for jpg in sorted(Path(__file__).resolve().parent.parent.joinpath('public', 'images').rglob('*.jpg')):
    webp = jpg.with_suffix('.webp')
    if webp.exists() and webp.stat().st_mtime >= jpg.stat().st_mtime:
        continue
    Image.open(jpg).save(webp, 'WEBP', quality=QUALITY, method=6)
    print(f'{jpg.name}: {jpg.stat().st_size // 1024} KB -> {webp.stat().st_size // 1024} KB')
