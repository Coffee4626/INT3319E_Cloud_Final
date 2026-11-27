"""Generate deterministic geometric-shape datasets; no external images or licenses needed."""
import io
import json
import random
import zipfile
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1] / 'frontend/public/datasets'
LABELS = ['circle', 'square', 'triangle']

def png(image):
    stream = io.BytesIO()
    image.save(stream, format='PNG')
    return stream.getvalue()

def main():
    ROOT.mkdir(parents=True, exist_ok=True)
    randomizer = random.Random(20261127)
    with zipfile.ZipFile(ROOT / 'shapes-classification.zip', 'w', zipfile.ZIP_DEFLATED) as classification, \
         zipfile.ZipFile(ROOT / 'shapes-segmentation.zip', 'w', zipfile.ZIP_DEFLATED) as segmentation:
        segmentation.writestr('classes.json', json.dumps(['background'] + LABELS))
        for split, count in [('train', 60), ('val', 20)]:
            for index, label in enumerate(LABELS):
                for i in range(count):
                    background = tuple(randomizer.randint(205, 245) for _ in range(3))
                    color = tuple(randomizer.randint(20, 160) for _ in range(3))
                    image = Image.new('RGB', (128, 128), background)
                    mask = Image.new('L', image.size, 0)
                    x, y = randomizer.randint(10, 28), randomizer.randint(10, 28)
                    size = randomizer.randint(60, 90)
                    for canvas, fill in [(image, color), (mask, index + 1)]:
                        draw = ImageDraw.Draw(canvas)
                        if label == 'circle': draw.ellipse((x, y, x + size, y + size), fill=fill)
                        elif label == 'square': draw.rectangle((x, y, x + size, y + size), fill=fill)
                        else: draw.polygon([(x + size // 2, y), (x, y + size), (x + size, y + size)], fill=fill)
                    name = f'{label}-{i:03d}'
                    classification.writestr(f'{split}/{label}/{name}.png', png(image))
                    segmentation.writestr(f'images/{split}/{name}.png', png(image))
                    segmentation.writestr(f'masks/{split}/{name}.png', png(mask))
                    if split == 'val' and i == 0:
                        (ROOT / f'try-{label}.png').write_bytes(png(image))
    print('Created classification + segmentation ZIPs: each 180 train / 60 val images, 128 × 128 px')

if __name__ == '__main__':
    main()
