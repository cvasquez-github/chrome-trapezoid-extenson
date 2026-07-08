#!/usr/bin/env python3
"""Genera los iconos PNG de la extension sin dependencias externas.

Dibuja un trapecio (mas angosto arriba) sobre un fondo oscuro, evocando la
correccion de keystone que hace la extension. Solo usa la libreria estandar.
"""
import os
import struct
import zlib

OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "icons")

BG = (11, 18, 32, 255)        # #0b1220 azul muy oscuro
TRAP = (96, 165, 250, 255)    # #60a5fa azul claro
TRAP_EDGE = (191, 219, 254, 255)  # borde mas claro


def lerp(a, b, t):
    return a + (b - a) * t


def build_pixels(n):
    pad = n * 0.14
    top_y = pad
    bot_y = n - pad
    top_half = n * 0.20
    bot_half = n * 0.42
    edge = max(1.0, n * 0.045)
    cx = n / 2.0
    px = bytearray()
    for y in range(n):
        px.append(0)  # filtro PNG "none" por fila
        for x in range(n):
            r, g, b, a = BG
            if top_y <= y <= bot_y:
                f = (y - top_y) / (bot_y - top_y)
                half = lerp(top_half, bot_half, f)
                left = cx - half
                right = cx + half
                fx = x + 0.5
                if left <= fx <= right:
                    if (fx - left) < edge or (right - fx) < edge \
                            or (y - top_y) < edge or (bot_y - y) < edge:
                        r, g, b, a = TRAP_EDGE
                    else:
                        r, g, b, a = TRAP
            px.extend((r, g, b, a))
    return bytes(px)


def write_png(path, n):
    raw = build_pixels(n)

    def chunk(tag, data):
        c = tag + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xffffffff)

    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", n, n, 8, 6, 0, 0, 0)  # 8-bit RGBA
    idat = zlib.compress(raw, 9)
    with open(path, "wb") as fh:
        fh.write(sig)
        fh.write(chunk(b"IHDR", ihdr))
        fh.write(chunk(b"IDAT", idat))
        fh.write(chunk(b"IEND", b""))


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    for size in (16, 48, 128):
        out = os.path.join(OUT_DIR, f"icon{size}.png")
        write_png(out, size)
        print("escrito", out)


if __name__ == "__main__":
    main()
