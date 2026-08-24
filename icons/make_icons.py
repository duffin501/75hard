"""Generates the app icons with no third-party deps.

The mark is a circle split along the anti-diagonal: Mary's teal in the upper
left, Jon's amber in the lower right, with a graphite gap between them. Two
halves, one goal. Rendered at 3x and box-downsampled so the edges are clean.
"""
import os, zlib, struct

HERE = os.path.dirname(os.path.abspath(__file__))

BG    = (0x12, 0x16, 0x18)
TEAL  = (0x42, 0xB7, 0x9E)
AMBER = (0xE3, 0xA3, 0x40)
SS    = 3  # supersample factor


def render(size, pad_ratio, bg):
    n = size * SS
    cx = cy = (n - 1) / 2.0
    radius = n * (0.5 - pad_ratio)
    gap = n * 0.021
    acc = [[0.0, 0.0, 0.0] for _ in range(size * size)]

    for sy in range(n):
        dy = sy - cy
        row = sy // SS
        for sx in range(n):
            dx = sx - cx
            if dx * dx + dy * dy <= radius * radius:
                d = dx + dy
                if d < -gap:
                    c = TEAL
                elif d > gap:
                    c = AMBER
                else:
                    c = bg
            else:
                c = bg
            p = acc[row * size + (sx // SS)]
            p[0] += c[0]; p[1] += c[1]; p[2] += c[2]

    inv = 1.0 / (SS * SS)
    return bytes(
        int(v * inv + 0.5)
        for px in acc
        for v in px
    )


def write_png(path, size, rgb):
    raw = b"".join(
        b"\x00" + rgb[y * size * 3:(y + 1) * size * 3]
        for y in range(size)
    )

    def chunk(tag, data):
        return (struct.pack(">I", len(data)) + tag + data
                + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))

    png = (b"\x89PNG\r\n\x1a\n"
           + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0))
           + chunk(b"IDAT", zlib.compress(raw, 9))
           + chunk(b"IEND", b""))
    with open(os.path.join(HERE, path), "wb") as f:
        f.write(png)
    return len(png)


# Maskable icons need the mark inside the safe zone; Apple squares off the
# corners itself, so that one gets a tighter crop and the same dark ground.
for name, size, pad in [("icon-192.png", 192, 0.16),
                        ("icon-512.png", 512, 0.16),
                        ("icon-maskable-512.png", 512, 0.26),
                        ("apple-touch-icon.png", 180, 0.14)]:
    n = write_png(name, size, render(size, pad, BG))
    print(f"{name:26} {size}x{size}  {n:,} bytes")
