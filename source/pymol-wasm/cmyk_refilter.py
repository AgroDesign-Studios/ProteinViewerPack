"""Re-encode a truecolour PNG losslessly, keeping its ancillary chunks (S1-10, standard library only).

usage: python3 -I cmyk_refilter.py <in.png> <out.png>      (in and out may be the same file)

wheel.sh runs it on the stage's pymol/pymol_path/data/pymol/cmyk.png, the table
`space cmyk` maps colours through (design 2026-11-16-pymol-wasm-slim S1-10,
evidence 3.10). Only the image data is redone: every scanline gets filter 1
(Sub), the data goes into one IDAT, compressed with zlib level 9 / window 15 /
memLevel 9 / the default strategy (the smallest of the study's survey:
255,652 -> 222,751 bytes for cmyk.png). Every other chunk stays as it was and
where it was: gAMA matters, because PyMOL's reader gamma-corrects only when the
file has one (layer0/MyPNG.cpp), and a PIL re-encode drops it. The decoded
pixels of the output are asserted identical to the input's. The output is a
function of the input and zlib (the builder image pins zlib).

Refused (exit 1, nothing written): anything but 8-bit truecolour (colour type 2)
or truecolour with alpha (6) without interlacing, a bad signature or chunk CRC,
an unknown critical chunk, IDAT chunks that are not consecutive, and image data
that does not decode to exactly height x (1 + width x bytes per pixel) bytes.

Ported from the study's exp3/v11 scripts/py/cmyk_refilter.py; same encoder.
Changes: the functions are importable (tests/test_cmyk_refilter.py,
tests/cmyk_table.mjs), the input is validated, a chunk that follows the image
data stays after it, and the output is written through a temporary file.
"""

from __future__ import annotations

import hashlib
import os
import struct
import sys
import zlib

SIG = b"\x89PNG\r\n\x1a\n"
CRITICAL = (b"IHDR", b"PLTE", b"IDAT", b"IEND")
BYTES_PER_PIXEL = {2: 3, 6: 4}  # 8-bit truecolour, 8-bit truecolour + alpha


class PNGError(ValueError):
    """The input is not a PNG this tool re-encodes."""


def chunks(raw: bytes) -> list[tuple[bytes, bytes]]:
    """The file's chunks as (type, data), in order; CRCs checked; IEND must end the file."""
    if raw[:8] != SIG:
        raise PNGError("not a PNG signature")
    p, out = 8, []
    while p < len(raw):
        if p + 12 > len(raw):
            raise PNGError("truncated chunk header at byte %d" % p)
        n, typ = struct.unpack(">I4s", raw[p : p + 8])
        if p + 12 + n > len(raw):
            raise PNGError("truncated %r chunk at byte %d" % (typ, p))
        data = raw[p + 8 : p + 8 + n]
        (crc,) = struct.unpack(">I", raw[p + 8 + n : p + 12 + n])
        if zlib.crc32(typ + data) & 0xFFFFFFFF != crc:
            raise PNGError("bad CRC in %r chunk at byte %d" % (typ, p))
        out.append((typ, data))
        p += 12 + n
        if typ == b"IEND":
            break
    if not out or out[-1][0] != b"IEND" or p != len(raw):
        raise PNGError("IEND missing, or data after IEND")
    return out


def build(chs: list[tuple[bytes, bytes]]) -> bytes:
    b = SIG
    for typ, data in chs:
        b += struct.pack(">I", len(data)) + typ + data + struct.pack(">I", zlib.crc32(typ + data) & 0xFFFFFFFF)
    return b


def paeth(a: int, b: int, c: int) -> int:
    pa, pb, pc = abs(b - c), abs(a - c), abs(a + b - 2 * c)
    return a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)


def unfilter(raw: bytes, w: int, h: int, bpp: int) -> bytes:
    stride, out, prev, p = w * bpp, bytearray(), bytearray(w * bpp), 0
    if len(raw) != h * (1 + stride):
        raise PNGError("image data is %d bytes, expected %d" % (len(raw), h * (1 + stride)))
    for _ in range(h):
        f = raw[p]
        p += 1
        line = bytearray(raw[p : p + stride])
        p += stride
        for i in range(stride):
            a = line[i - bpp] if i >= bpp else 0
            if f == 1:
                line[i] = (line[i] + a) & 255
            elif f == 2:
                line[i] = (line[i] + prev[i]) & 255
            elif f == 3:
                line[i] = (line[i] + ((a + prev[i]) >> 1)) & 255
            elif f == 4:
                line[i] = (line[i] + paeth(a, prev[i], prev[i - bpp] if i >= bpp else 0)) & 255
            elif f != 0:
                raise PNGError("bad filter type %d" % f)
        out += line
        prev = line
    return bytes(out)


def sub_filter(pix: bytes, w: int, h: int, bpp: int) -> bytes:
    stride, out = w * bpp, bytearray()
    for y in range(h):
        line = pix[y * stride : (y + 1) * stride]
        out.append(1)
        out += bytes((line[i] - (line[i - bpp] if i >= bpp else 0)) & 255 for i in range(stride))
    return bytes(out)


def decode(raw: bytes) -> tuple[list[tuple[bytes, bytes]], int, int, int, bytes]:
    """(chunks, width, height, bytes per pixel, pixels) of a PNG this tool accepts."""
    chs = chunks(raw)
    if chs[0][0] != b"IHDR" or len(chs[0][1]) != 13:
        raise PNGError("IHDR is not the first chunk")
    w, h, depth, ctype, comp, flt, inter = struct.unpack(">IIBBBBB", chs[0][1])
    if depth != 8 or ctype not in BYTES_PER_PIXEL or comp != 0 or flt != 0 or inter != 0:
        raise PNGError("unsupported: bit depth %d, colour type %d, compression %d, filter %d, interlace %d"
                       % (depth, ctype, comp, flt, inter))
    for typ, _ in chs:
        if typ[:1].isupper() and typ not in CRITICAL:
            raise PNGError("unknown critical chunk %r" % typ)
    kinds = [t for t, _ in chs]
    first = kinds.index(b"IDAT") if b"IDAT" in kinds else -1
    if first < 0:
        raise PNGError("no IDAT")
    run = first
    while run < len(kinds) and kinds[run] == b"IDAT":
        run += 1
    if b"IDAT" in kinds[run:]:
        raise PNGError("IDAT chunks are not consecutive")
    try:
        data = zlib.decompress(b"".join(d for t, d in chs if t == b"IDAT"))
    except zlib.error as e:
        raise PNGError("image data does not inflate: %s" % e) from None
    bpp = BYTES_PER_PIXEL[ctype]
    return chs, w, h, bpp, unfilter(data, w, h, bpp)


def encode_like(chs: list[tuple[bytes, bytes]], w: int, h: int, bpp: int, pix: bytes) -> bytes:
    """`pix` as a PNG with every chunk of `chs` in place, the IDAT run replaced by one Sub-filtered IDAT."""
    co = zlib.compressobj(9, zlib.DEFLATED, 15, 9, zlib.Z_DEFAULT_STRATEGY)
    z = co.compress(sub_filter(pix, w, h, bpp)) + co.flush()
    out: list[tuple[bytes, bytes]] = []
    for typ, data in chs:
        if typ != b"IDAT":
            out.append((typ, data))
        elif not out or out[-1][0] != b"IDAT":
            out.append((b"IDAT", z))
    return build(out)


def refilter(raw: bytes) -> tuple[bytes, dict[str, object]]:
    """The re-encoded PNG and a summary; the pixels and the other chunks are asserted unchanged."""
    chs, w, h, bpp, pix = decode(raw)
    new = encode_like(chs, w, h, bpp, pix)
    c2, w2, h2, bpp2, pix2 = decode(new)
    if (w2, h2, bpp2) != (w, h, bpp) or pix2 != pix:
        raise AssertionError("pixels changed")
    if [c for c in c2 if c[0] != b"IDAT"] != [c for c in chs if c[0] != b"IDAT"]:
        raise AssertionError("a chunk other than IDAT changed or moved")
    info = {
        "in_bytes": len(raw),
        "out_bytes": len(new),
        "kept": [t.decode("latin-1") for t, _ in chs if t not in (b"IDAT", b"IEND")],
        "pixels_sha256": hashlib.sha256(pix).hexdigest(),
        "out_sha256": hashlib.sha256(new).hexdigest(),
        "zlib": zlib.ZLIB_RUNTIME_VERSION,
    }
    return new, info


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print(__doc__, file=sys.stderr)
        return 2
    src, dst = argv[1:3]
    with open(src, "rb") as fh:
        raw = fh.read()
    try:
        new, info = refilter(raw)
    except PNGError as e:
        print(f"cmyk_refilter: {src}: {e}", file=sys.stderr)
        return 1
    tmp = dst + ".refilter-tmp"
    with open(tmp, "wb") as fh:
        fh.write(new)
    os.replace(tmp, dst)
    print(
        "cmyk_refilter: %s: %d -> %d bytes (%+d); chunks kept %s; pixels identical (sha256 %s); zlib %s; out sha256 %s"
        % (dst, info["in_bytes"], info["out_bytes"], info["out_bytes"] - info["in_bytes"], info["kept"],
           str(info["pixels_sha256"])[:16], info["zlib"], str(info["out_sha256"])[:16])
    )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
