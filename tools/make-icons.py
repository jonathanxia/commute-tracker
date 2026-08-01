#!/usr/bin/env python3
"""Generate the PWA icons with nothing but the Python standard library.

No Pillow, no build step. Draws a rounded-square tile with a stopwatch glyph
(the thing this app replaces) at 4x supersampling, then box-downsamples.

    python3 tools/make-icons.py
"""

import math
import os
import struct
import zlib

BG = (0x12, 0x16, 0x1D)
ACCENT = (0x5A, 0xB0, 0xFF)
DIM = (0x8B, 0x97, 0xA8)
SS = 4  # supersampling factor

OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "icons")
SIZES = {"icon-192.png": 192, "icon-512.png": 512, "apple-touch-icon.png": 180}


def write_png(path, width, height, rgb_rows):
    """rgb_rows: list of rows, each a bytearray of length width*3."""
    raw = bytearray()
    for row in rgb_rows:
        raw.append(0)  # filter type 0 (None)
        raw.extend(row)

    def chunk(tag, data):
        out = struct.pack(">I", len(data)) + tag + data
        return out + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)  # 8-bit truecolour
    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        + chunk(b"IEND", b"")
    )
    with open(path, "wb") as fh:
        fh.write(png)


def blend(dst, src, alpha):
    return tuple(round(d + (s - d) * alpha) for d, s in zip(dst, src))


def render(size):
    """Render at size*SS then box-downsample to size. Returns list of rgb rows."""
    n = size * SS
    # Work in a flat list of (r,g,b) tuples.
    px = [BG] * (n * n)

    cx = cy = n / 2.0
    radius = n * 0.22  # rounded-square corner radius

    # --- rounded square: knock the corners out to transparent-ish black.
    # iOS masks the icon itself, so we just keep the tile flat and let the OS
    # clip. We draw a subtle inset border instead of faking a corner radius.
    ring_r = n * 0.30
    ring_w = n * 0.055

    # stopwatch crown (small stem at 12 o'clock)
    crown_w = n * 0.055
    crown_top = cy - ring_r - ring_w * 1.9
    crown_bot = cy - ring_r + ring_w * 0.2

    # hand: from centre pointing to ~1 o'clock
    hand_ang = math.radians(-58)
    hand_len = ring_r * 0.62
    hx, hy = cx + math.cos(hand_ang) * hand_len, cy + math.sin(hand_ang) * hand_len
    hand_w = n * 0.035

    def dist_to_seg(x, y, x1, y1, x2, y2):
        dx, dy = x2 - x1, y2 - y1
        L2 = dx * dx + dy * dy
        t = 0.0 if L2 == 0 else max(0.0, min(1.0, ((x - x1) * dx + (y - y1) * dy) / L2))
        return math.hypot(x - (x1 + t * dx), y - (y1 + t * dy))

    for y in range(n):
        fy = y + 0.5
        for x in range(n):
            fx = x + 0.5
            i = y * n + x

            # subtle vignette-free flat bg already set; draw glyph parts:
            d_ring = abs(math.hypot(fx - cx, fy - cy) - ring_r)
            if d_ring <= ring_w / 2:
                px[i] = ACCENT
                continue

            if abs(fx - cx) <= crown_w / 2 and crown_top <= fy <= crown_bot:
                px[i] = ACCENT
                continue

            if dist_to_seg(fx, fy, cx, cy, hx, hy) <= hand_w / 2:
                px[i] = ACCENT
                continue

            # lap ticks: four short marks at the cardinal-ish angles, dimmer
            ang = math.atan2(fy - cy, fx - cx)
            r = math.hypot(fx - cx, fy - cy)
            if ring_r + ring_w * 1.4 <= r <= ring_r + ring_w * 2.6:
                deg = (math.degrees(ang) + 360) % 360
                if any(abs(((deg - t + 180) % 360) - 180) < 4 for t in (0, 90, 180, 270)):
                    px[i] = DIM

    # --- corner rounding: fade the tile's corners toward black so the icon
    # still looks intentional on Android's non-masked launchers.
    for y in range(n):
        fy = y + 0.5
        for x in range(n):
            fx = x + 0.5
            # distance outside the rounded-rect
            qx = abs(fx - cx) - (n / 2 - radius)
            qy = abs(fy - cy) - (n / 2 - radius)
            outside = math.hypot(max(qx, 0), max(qy, 0)) - radius
            if outside > 0:
                px[y * n + x] = (0, 0, 0)

    # --- box downsample SS x SS
    rows = []
    for oy in range(size):
        row = bytearray()
        for ox in range(size):
            r = g = b = 0
            for sy in range(SS):
                base = (oy * SS + sy) * n + ox * SS
                for sx in range(SS):
                    p = px[base + sx]
                    r += p[0]
                    g += p[1]
                    b += p[2]
            k = SS * SS
            row += bytes((r // k, g // k, b // k))
        rows.append(row)
    return rows


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    for name, size in SIZES.items():
        path = os.path.join(OUT_DIR, name)
        write_png(path, size, size, render(size))
        print(f"wrote {path} ({size}x{size})")


if __name__ == "__main__":
    main()
