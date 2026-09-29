"""Render a contact sheet of all standard views for visual sign-off.

The contours come from the app's own modules (site/js/geom.js and
site/js/slicer.js, run in QuickJS), so the shapes are exactly what the page
draws.  The paint order, tissue palette and abbreviations are read out of
site/js/sector.js, so the colours and labels match too.

This is NOT a browser screenshot: it is an independent render of the same
geometry, for checking that each view cuts the right structures in the right
arrangement.  It is written as plain SVG with no numeric dependencies, so it
cannot be broken by whatever BLAS happens to be installed.

Usage:  python tools/contact_sheet.py [-o site/docs/contact_sheet.svg]
"""
import argparse
import json
import math
import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from verify_planes import build_context, SITE  # noqa: E402

PANEL_W, PANEL_H, COLS = 250.0, 286.0, 5
BG, INK, DIM = "#0a0e14", "#e6edf6", "#93a3b8"


SKIP_2D = {"spine"}   # see sector.js: bone is not drawn as filled tissue


def read_palette():
    """Take the tissue colours, paint order and abbreviations from sector.js."""
    src = (SITE / "js" / "sector.js").read_text(encoding="utf8")
    block = re.search(r"const TISSUE = \{(.*?)\n\};", src, re.S).group(1)
    tissue = {n: (f, e) for n, f, e in re.findall(
        r"(\w+):\s*\{\s*fill:\s*'([^']+)',\s*edge:\s*'([^']+)'", block)}
    order = re.findall(r"'([a-z_0-9]+)'", re.search(
        r"PAINT_ORDER = \[(.*?)\];", src, re.S).group(1))
    short = dict(re.findall(r"(\w+): '([^']+)'", re.search(
        r"SHORT = \{(.*?)\n\};", src, re.S).group(1)))
    return tissue, order, short


def centroid(loop):
    a = cx = cy = 0.0
    n = len(loop)
    for i in range(n):
        p, q = loop[i], loop[(i + 1) % n]
        cr = p[0] * q[1] - q[0] * p[1]
        a += cr
        cx += (p[0] + q[0]) * cr
        cy += (p[1] + q[1]) * cr
    a /= 2.0
    if abs(a) < 1e-9:
        return None, 0.0
    return (cx / (6 * a), cy / (6 * a)), abs(a)


def esc(s):
    return (s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))


def panel_svg(view, slices, tissue, order, short, idx):
    depth, sect = view["depth"], view["sector"]
    half = math.radians(sect / 2.0)
    pad_top, pad_bottom = 34.0, 12.0
    plot_h = PANEL_H - pad_top - pad_bottom
    half_w = depth * math.sin(half)
    s = min((PANEL_W - 26.0) / (2 * half_w), plot_h / depth)
    ox, oy = PANEL_W / 2.0, pad_top
    cid = f"clip{idx}"

    def X(x):
        return ox + x * s

    def Y(y):
        return oy + y * s

    # sector wedge outline, used as the clip path too
    x0, y0 = X(-depth * math.sin(half)), Y(depth * math.cos(half))
    x1, y1 = X(depth * math.sin(half)), Y(depth * math.cos(half))
    wedge = (f"M {X(0):.2f} {Y(0):.2f} L {x0:.2f} {y0:.2f} "
             f"A {depth * s:.2f} {depth * s:.2f} 0 0 1 {x1:.2f} {y1:.2f} Z")

    out = [f'<g transform="translate(0,0)">',
           f'<clipPath id="{cid}"><path d="{wedge}"/></clipPath>',
           f'<path d="{wedge}" fill="#0a0c10" stroke="#5a7091" '
           f'stroke-width="0.7"/>',
           f'<g clip-path="url(#{cid})">']

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
                d = "M " + " L ".join(f"{X(p[0]):.2f} {Y(p[1]):.2f}"
                                      for p in loop) + " Z"
                out.append(f'<path d="{d}" fill="{colour}" stroke="{edge}" '
                           f'stroke-width="0.4"/>')
    out.append("</g>")

    # depth ticks, every centimetre down the left edge of the sector
    for d in range(1, int(depth) + 1):
        tx, ty = X(-d * math.sin(half)), Y(d * math.cos(half))
        out.append(f'<line x1="{tx - 4:.2f}" y1="{ty:.2f}" x2="{tx:.2f}" '
                   f'y2="{ty:.2f}" stroke="#7f93b0" stroke-width="0.5"/>')
    out.append(f'<text x="{X(-half_w) - 6:.2f}" y="{oy + 7:.2f}" fill="{DIM}" '
               f'font-size="5" text-anchor="end">cm</text>')

    # the index-mark side marker: index maps to image right
    mx = X(0.72 * half_w)
    out.append(f'<polygon points="{mx:.2f},{oy + 6:.2f} {mx - 4:.2f},'
               f'{oy - 3:.2f} {mx + 4:.2f},{oy - 3:.2f}" fill="#ffd24a"/>')

    # labels, largest loop per structure, skipped when outside the sector
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
        rr = math.hypot(c[0], c[1])
        if rr > depth or c[1] <= 0 or abs(math.atan2(c[0], c[1])) > half:
            continue
        px, py = X(c[0]), Y(c[1])
        if any(math.hypot(px - qx, py - qy) < 15 for qx, qy in placed):
            continue
        placed.append((px, py))
        txt = esc(short.get(sid, sid).upper())
        w = 4.0 + 3.05 * len(txt)
        out.append(f'<rect x="{px - w / 2:.2f}" y="{py - 4.6:.2f}" '
                   f'width="{w:.2f}" height="9.2" rx="1.4" fill="#060a10" '
                   f'fill-opacity="0.66"/>')
        out.append(f'<text x="{px:.2f}" y="{py + 2.3:.2f}" fill="{INK}" '
                   f'font-size="5.2" font-weight="600" '
                   f'text-anchor="middle">{txt}</text>')

    # title block
    stated = f"  (pointer {view['clock_stated']})" if view.get("clock_stated") else ""
    out.append(f'<text x="{PANEL_W / 2:.1f}" y="11" fill="{INK}" font-size="6.6" '
               f'font-weight="600" text-anchor="middle">'
               f'{esc(view["name"])}</text>')
    out.append(f'<text x="{PANEL_W / 2:.1f}" y="20" fill="{DIM}" font-size="5.3" '
               f'text-anchor="middle">{esc(view["window_label"] + stated)}</text>')
    out.append(f'<text x="{PANEL_W / 2:.1f}" y="28.5" fill="#ffd24a" '
               f'font-size="5.0" text-anchor="middle">'
               f'index {esc(view["index_toward"])}</text>')
    out.append("</g>")
    return "\n".join(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("-o", "--out", default="site/docs/contact_sheet.svg")
    args = ap.parse_args()

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
    W = COLS * PANEL_W
    H = rows * PANEL_H + 56
    parts = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W:.0f}" '
             f'height="{H:.0f}" viewBox="0 0 {W:.0f} {H:.0f}">',
             f'<rect width="{W:.0f}" height="{H:.0f}" fill="{BG}"/>',
             f'<text x="{W / 2:.0f}" y="21" fill="{INK}" font-size="15" '
             f'font-weight="600" text-anchor="middle" '
             f'font-family="system-ui,sans-serif">Neonatal echo trainer - '
             f'{len(vs)} standard views, rendered from the app\'s own '
             f'cross-section code</text>',
             f'<text x="{W / 2:.0f}" y="38" fill="{DIM}" font-size="9.5" '
             f'text-anchor="middle" font-family="system-ui,sans-serif">'
             f'Each panel is the imaging plane of one probe pose, clipped to its '
             f'sector. The index mark maps to image right (yellow marker). '
             f'Geometry render, not a browser screenshot.</text>',
             '<g font-family="system-ui,-apple-system,Segoe UI,sans-serif">']
    for i, v in enumerate(vs):
        sl = json.loads(ctx.eval(f"loops({json.dumps(v)})"))
        col, row = i % COLS, i // COLS
        parts.append(f'<g transform="translate({col * PANEL_W:.0f},'
                     f'{48 + row * PANEL_H:.0f})">')
        parts.append(panel_svg(v, sl, tissue, order, short, i))
        parts.append("</g>")
    parts.append("</g></svg>")

    out = pathlib.Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text("\n".join(parts), encoding="utf8")
    print(f"wrote {out}  ({rows}x{COLS} panels, {len(vs)} views, "
          f"{out.stat().st_size // 1024} kB)")


if __name__ == "__main__":
    main()
