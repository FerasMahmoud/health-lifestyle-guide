"""Generate PWA icons for health lifestyle guide."""
from PIL import Image, ImageDraw, ImageFont
import os

os.chdir(os.path.dirname(os.path.abspath(__file__)))

for size in [192, 512]:
    img = Image.new('RGBA', (size, size), (10, 10, 15, 255))
    draw = ImageDraw.Draw(img)

    # Background circle with gradient effect
    cx, cy = size // 2, size // 2
    r = int(size * 0.42)
    for i in range(r, 0, -1):
        ratio = i / r
        # Blue to purple gradient
        red = int(79 + (168 - 79) * (1 - ratio))
        green = int(172 + (85 - 172) * (1 - ratio))
        blue = int(254 + (247 - 254) * (1 - ratio))
        alpha = int(200 + 55 * (1 - ratio))
        draw.ellipse([cx-i, cy-i, cx+i, cy+i], fill=(red, green, blue, alpha))

    # Heart + pulse line (health symbol)
    # Draw a simple heart shape
    heart_size = int(size * 0.22)
    hx, hy = cx, cy - int(size * 0.05)

    # Heart using two circles + triangle
    hr = int(heart_size * 0.5)
    # Left circle
    draw.ellipse([hx - heart_size + hr//4, hy - hr, hx - hr//4, hy + hr//2], fill='white')
    # Right circle
    draw.ellipse([hx + hr//4, hy - hr, hx + heart_size - hr//4, hy + hr//2], fill='white')
    # Triangle bottom
    draw.polygon([
        (hx - heart_size + hr//4, hy),
        (hx + heart_size - hr//4, hy),
        (hx, hy + heart_size)
    ], fill='white')

    # Pulse line across
    lw = max(2, size // 64)
    pulse_y = cy + int(size * 0.02)
    pts = [
        (cx - int(size*0.28), pulse_y),
        (cx - int(size*0.12), pulse_y),
        (cx - int(size*0.07), pulse_y - int(size*0.1)),
        (cx, pulse_y + int(size*0.08)),
        (cx + int(size*0.07), pulse_y - int(size*0.06)),
        (cx + int(size*0.12), pulse_y),
        (cx + int(size*0.28), pulse_y),
    ]
    draw.line(pts, fill='white', width=lw*2, joint='curve')

    img.save(f'icon-{size}.png')
    print(f'Created icon-{size}.png')
