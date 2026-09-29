"""Raster version of the contact sheet, drawn with PIL.

Same geometry and palette as contact_sheet.py; separate file because it needs
Pillow.  Deliberately avoids numpy/matplotlib so it keeps working regardless of
the numeric stack.

Usage:  python tools/render_png.py [-o site/docs/contact_sheet.png] [--scale 2]
"""
import argparse
import json
import math
import pathlib
import sys

from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from verify_planes import build_context, SITE  # noqa: E402
from contact_sheet import read_palette, centroid, SKIP_2D  # noqa: E402

COLS = 5
PW, PH = 250, 286
BG = (10, 14, 20)


def font(size):
    for name in ("segoeui.ttf", "arial.ttf", "DejaVuSans.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def hexrgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def draw_panel(img, dr, ox0, oy0, view, slices, tissue, order, short, S):
    depth, sect = view["depth"], view["sector"]
    half = math.radians(sect / 2)
    pad_top, pad_bot = 34, 12
    half_w = depth * math.sin(half)
    s = min((PW - 26) / (2 * half_w), (PH - pad_top - pad_bot) / depth)
    ox, oy = ox0 + PW / 2, oy0 + pad_top

    def P(p):
        return (S * (ox + p[0] * s), S * (oy + p[1] * s))

    # sector wedge as a mask, so anatomy is clipped to the field of view
    wedge = [P((0, 0))]
    for k in range(65):
        a = -half + 2 * half * k / 64
        wedge.append(P((math.sin(a) * depth, math.cos(a) * depth)))
    mask = Image.new("L", img.size, 0)
    ImageDraw.Draw(mask).polygon(wedge, fill=255)
    layer = Image.new("RGB", img.size, (10, 12, 16))
    ld = ImageDraw.Draw(layer)

    by = {r["id"]: r for r in slices}
    seq = [i for i in order if i in by] + [r["id"] for r in slices
                                           if r["id"] not in order]
    for sid in seq:
        if sid in SKIP_2D:
            continue
        r = by[sid]
        fill, edge = tissue.get(r["tissue"], tissue["myocardium"])
        for role, colour in (("outer", fill), ("cavity", tissue["blood"][0])):
            for loop in r[role]:
                if len(loop) < 3:
                    continue
                pts = [P(q) for q in loop]
                ld.polygon(pts, fill=hexrgb(colour), outline=hexrgb(edge))
    img.paste(layer, (0, 0), mask)
    dr.line(wedge[1:] + [wedge[0], wedge[1]], fill=(90, 112, 145),
            width=max(1, S // 2))

    for d in range(1, int(depth) + 1):
        x, y = P((-d * math.sin(half), d * math.cos(half)))
        dr.line([x - 4 * S, y, x, y], fill=(127, 147, 176), width=1)
    mx, my = P((0.72 * half_w, 0))
    dr.polygon([(mx, my + 6 * S), (mx - 4 * S, my - 3 * S),
                (mx + 4 * S, my - 3 * S)], fill=(255, 210, 74))

    f_lab, f_t1, f_t2, f_t3 = (font(int(5.2 * S)), font(int(6.8 * S)),
                               font(int(5.4 * S)), font(int(5.1 * S)))
    placed = []
    cands = []
    for r in slices:
        if r["group"] in ("context", "flow"):
            continue
        best, ba = None, 0.0
        for loop in r["outer"] + r["cavity"]:
            c, a = centroid(loop)
            if c and a > ba and a > 0.05:
                best, ba = c, a
        if best:
            cands.append((ba, r["id"], best))
    for _, sid, c in sorted(cands, reverse=True):
        if (math.hypot(*c) > depth or c[1] <= 0
                or abs(math.atan2(c[0], c[1])) > half):
            continue
        px, py = P(c)
        if any(math.hypot(px - qx, py - qy) < 15 * S for qx, qy in placed):
            continue
        placed.append((px, py))
        txt = short.get(sid, sid).upper()
        w = dr.textlength(txt, font=f_lab)
        dr.rectangle([px - w / 2 - 2 * S, py - 5 * S,
                      px + w / 2 + 2 * S, py + 5 * S], fill=(8, 12, 19))
        dr.text((px - w / 2, py - 4 * S), txt, font=f_lab, fill=(238, 243, 250))

    cx = S * (ox0 + PW / 2)
    for txt, fnt, yy, col in (
            (view["name"], f_t1, 4, (238, 243, 250)),
            (view["window_label"]
             + (f"  (pointer {view['clock_stated']})"
                if view.get("clock_stated") else ""), f_t2, 14, (147, 163, 184)),
            ("index " + view["index_toward"], f_t3, 23, (255, 210, 74))):
        w = dr.textlength(txt, font=fnt)
        dr.text((cx - w / 2, S * (oy0 + yy)), txt, font=fnt, fill=col)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("-o", "--out", default="site/docs/contact_sheet.png")
    ap.add_argument("--scale", type=int, default=3)
    a = ap.parse_args()
    S = a.scale

    ctx = build_context()
    ctx.eval("""
    function loops(v){
      const res = sliceAll(STR, {origin:v.contact, u:v.index, v:v.beam, n:v.normal});
      return JSON.stringify(res.map(r => ({id:r.id, group:r.group,
        tissue:r.tissue, outer:r.outer, cavity:r.cavity})));
    }""")
    views = json.loads((SITE / "data" / "views.json").read_text(encoding="utf8"))
    tissue, order, short = read_palette()
    vs = views["views"]
    rows = math.ceil(len(vs) / COLS)
    W, H = COLS * PW * S, (rows * PH + 56) * S
    img = Image.new("RGB", (W, H), BG)
    dr = ImageDraw.Draw(img)

    t1, t2 = font(int(15 * S)), font(int(9.5 * S))
    for txt, fnt, y, col in (
        (f"Neonatal echo trainer - {len(vs)} standard views, rendered from the "
         f"app's own cross-section code", t1, 8, (238, 243, 250)),
        ("Each panel is the imaging plane of one probe pose, clipped to its "
         "sector. The index mark maps to image right (yellow marker). "
         "Geometry render, not a browser screenshot.", t2, 30, (147, 163, 184))):
        w = dr.textlength(txt, font=fnt)
        dr.text((W / 2 - w / 2, y * S), txt, font=fnt, fill=col)

    for i, v in enumerate(vs):
        sl = json.loads(ctx.eval(f"loops({json.dumps(v)})"))
        draw_panel(img, dr, (i % COLS) * PW, 48 + (i // COLS) * PH,
                   v, sl, tissue, order, short, S)

    out = pathlib.Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    img.save(out)
    print(f"wrote {out}  {img.size[0]}x{img.size[1]}px, "
          f"{out.stat().st_size // 1024} kB")


if __name__ == "__main__":
    main()
