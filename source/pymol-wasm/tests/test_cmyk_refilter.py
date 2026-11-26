"""Unit tests for cmyk_refilter.py on synthetic PNGs (stdlib only).

    python3 -I -B tests/test_cmyk_refilter.py

The tool rewrites the image data of the wheel's cmyk.png and must leave the
pixels and every other chunk alone (S1-10). These cases build PNGs whose rows
use each of the five filter types, in both accepted colour types, with
ancillary chunks before and after the image data, and check the output decodes
to the same pixels, keeps the chunks in place, is the same bytes every time,
and that formats it does not handle are refused rather than re-encoded.
"""

import os
import struct
import subprocess
import sys
import tempfile
import unittest
import zlib

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import cmyk_refilter as cr  # noqa: E402

TOOL = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "cmyk_refilter.py")


def forward(f, line, prev, bpp):
    """Filter one scanline with filter type f (the inverse of cr.unfilter's step)."""
    out = bytearray()
    for i, x in enumerate(line):
        a = line[i - bpp] if i >= bpp else 0
        b = prev[i]
        c = prev[i - bpp] if i >= bpp else 0
        pred = [0, a, b, (a + b) >> 1, cr.paeth(a, b, c)][f]
        out.append((x - pred) & 255)
    return bytes(out)


def make_png(w, h, ctype, pix, filters, extra_before=(), extra_after=(), split_idat=1, depth=8, interlace=0):
    bpp = cr.BYTES_PER_PIXEL.get(ctype, 3)
    stride = w * bpp
    raw = bytearray()
    prev = bytes(stride)
    for y in range(h):
        line = pix[y * stride : (y + 1) * stride]
        f = filters[y % len(filters)]
        raw.append(f)
        raw += forward(f, line, prev, bpp)
        prev = line
    z = zlib.compress(bytes(raw), 1)
    parts = [z[k * len(z) // split_idat : (k + 1) * len(z) // split_idat] for k in range(split_idat)]
    chs = [(b"IHDR", struct.pack(">IIBBBBB", w, h, depth, ctype, 0, 0, interlace))]
    chs += list(extra_before) + [(b"IDAT", p) for p in parts] + list(extra_after) + [(b"IEND", b"")]
    return cr.build(chs)


def pixels(w, h, bpp, seed=7):
    x = seed
    out = bytearray()
    for _ in range(w * h * bpp):
        x = (x * 1103515245 + 12345) & 0x7FFFFFFF
        out.append((x >> 16) & 255)
    return bytes(out)


GAMA = (b"gAMA", struct.pack(">I", 45000))
TEXT = (b"tEXt", b"Software\x00test")
TIME = (b"tIME", struct.pack(">HBBBBB", 2026, 11, 17, 0, 0, 0))


class Refilter(unittest.TestCase):
    def check(self, w, h, ctype, filters, **kw):
        bpp = cr.BYTES_PER_PIXEL[ctype]
        pix = pixels(w, h, bpp)
        src = make_png(w, h, ctype, pix, filters, **kw)
        new, info = cr.refilter(src)
        chs, w2, h2, bpp2, pix2 = cr.decode(new)
        self.assertEqual((w2, h2, bpp2), (w, h, bpp))
        self.assertEqual(pix2, pix)
        # every row is Sub-filtered in exactly one IDAT
        data = zlib.decompress(b"".join(d for t, d in chs if t == b"IDAT"))
        self.assertEqual([data[y * (1 + w * bpp)] for y in range(h)], [1] * h)
        self.assertEqual(sum(1 for t, _ in chs if t == b"IDAT"), 1)
        return src, new, chs, info

    def test_each_filter_type_both_colour_types(self):
        for ctype in (2, 6):
            for f in range(5):
                with self.subTest(ctype=ctype, filter=f):
                    self.check(7, 5, ctype, [f])

    def test_mixed_filters_and_split_idat(self):
        self.check(9, 10, 2, [0, 1, 2, 3, 4], split_idat=3)

    def test_ancillary_chunks_stay_in_place(self):
        src, new, chs, info = self.check(6, 4, 2, [4, 2], extra_before=(GAMA, TEXT), extra_after=(TIME,), split_idat=2)
        self.assertEqual([t for t, _ in chs], [b"IHDR", b"gAMA", b"tEXt", b"IDAT", b"tIME", b"IEND"])
        self.assertEqual([c for c in chs if c[0] != b"IDAT"], [c for c in cr.chunks(src) if c[0] != b"IDAT"])
        self.assertEqual(info["kept"], ["IHDR", "gAMA", "tEXt", "tIME"])

    def test_output_is_deterministic(self):
        pix = pixels(8, 8, 4)
        src = make_png(8, 8, 6, pix, [3], extra_before=(GAMA,))
        a, _ = cr.refilter(src)
        b, _ = cr.refilter(src)
        self.assertEqual(a, b)
        # refiltering the output again gives the same bytes (a fixed point)
        self.assertEqual(cr.refilter(a)[0], a)

    def test_encoder_settings_are_the_ported_ones(self):
        pix = pixels(5, 3, 3)
        new, _ = cr.refilter(make_png(5, 3, 2, pix, [0]))
        co = zlib.compressobj(9, zlib.DEFLATED, 15, 9, zlib.Z_DEFAULT_STRATEGY)
        want = co.compress(cr.sub_filter(pix, 5, 3, 3)) + co.flush()
        self.assertEqual([d for t, d in cr.chunks(new) if t == b"IDAT"], [want])

    def test_cli_rewrites_in_place(self):
        pix = pixels(4, 4, 3)
        src = make_png(4, 4, 2, pix, [2], extra_before=(GAMA, TEXT))
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "cmyk.png")
            with open(p, "wb") as fh:
                fh.write(src)
            r = subprocess.run([sys.executable, "-I", TOOL, p, p], capture_output=True, text=True)
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertEqual(os.listdir(d), ["cmyk.png"])
            with open(p, "rb") as fh:
                self.assertEqual(fh.read(), cr.refilter(src)[0])


class Refusals(unittest.TestCase):
    def refused(self, raw):
        with self.assertRaises(cr.PNGError):
            cr.refilter(raw)

    def test_unsupported_formats(self):
        pix = pixels(4, 4, 3)
        self.refused(make_png(4, 4, 2, pix, [0], depth=16))      # 16-bit
        self.refused(make_png(4, 4, 0, pix, [0]))                # greyscale
        self.refused(make_png(4, 4, 3, pix, [0]))                # palette
        self.refused(make_png(4, 4, 2, pix, [0], interlace=1))   # Adam7

    def test_damaged_or_odd_files(self):
        pix = pixels(4, 4, 3)
        good = make_png(4, 4, 2, pix, [0])
        self.refused(b"GIF89a" + good[6:])
        bad_crc = bytearray(good)
        bad_crc[20] ^= 1  # inside IHDR's data (bytes 16-28), so its CRC no longer matches
        self.refused(bytes(bad_crc))
        self.refused(good + b"trailing")
        self.refused(good[:-12])  # no IEND
        self.refused(make_png(4, 4, 2, pix, [0], extra_before=((b"ZZZZ", b"x"),)))  # unknown critical chunk
        split = cr.chunks(make_png(4, 4, 2, pix, [0], split_idat=2))
        self.refused(cr.build(split[:2] + [TEXT] + split[2:]))   # IDAT, tEXt, IDAT
        short = cr.chunks(good)
        short = [(t, zlib.compress(zlib.decompress(d)[:-1])) if t == b"IDAT" else (t, d) for t, d in short]
        self.refused(cr.build(short))
        bad_filter = cr.chunks(good)
        bad_filter = [(t, zlib.compress(b"\x05" + zlib.decompress(d)[1:])) if t == b"IDAT" else (t, d) for t, d in bad_filter]
        self.refused(cr.build(bad_filter))

    def test_cli_refusal_writes_nothing(self):
        pix = pixels(4, 4, 3)
        with tempfile.TemporaryDirectory() as d:
            src = os.path.join(d, "in.png")
            dst = os.path.join(d, "out.png")
            with open(src, "wb") as fh:
                fh.write(make_png(4, 4, 3, pix, [0]))
            r = subprocess.run([sys.executable, "-I", TOOL, src, dst], capture_output=True, text=True)
            self.assertEqual(r.returncode, 1)
            self.assertFalse(os.path.exists(dst))


if __name__ == "__main__":
    unittest.main()
