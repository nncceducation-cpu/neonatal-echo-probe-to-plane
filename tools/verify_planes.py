"""Verify every standard view against the anatomy, by running the app's own code.

This does NOT re-implement the slicing in Python.  It loads site/js/geom.js and
site/js/slicer.js - the exact modules the browser runs - into a QuickJS
interpreter and asks them what each view's imaging plane actually cuts.  A
Python re-implementation could agree with itself while the shipped app was
wrong; this cannot.

For each view it checks:
  * every structure in `expect` is visible inside the sector wedge;
  * no structure in `absent` is visible there;
  * the plane still satisfies the geometric contract it was built from
    (aim point in plane, long axis in plane, vessel centreline in plane).

Usage:  python tools/verify_planes.py [--json report.json]
Exit code 0 if everything passes, 1 otherwise.
"""
import argparse
import json
import pathlib
import re
import sys

try:
    import quickjs
except ImportError:
    sys.exit("needs the 'quickjs' package:  pip install quickjs")

ROOT = pathlib.Path(__file__).resolve().parent.parent
SITE = ROOT / "site" if (ROOT / "site").is_dir() else ROOT

# Tolerances in millimetres / degrees, applied per view family.  A metric is
# only asserted where it is meaningful: it makes no sense to demand that a
# deliberately off-axis sweep contain the long axis, or that a plane fitted to
# a curved great vessel pass exactly through its aim point.
TOL = {
    # canonical cardiac sections: the plane must BE the section, exactly
    "long_axis":  {"section_deviation_deg": 0.5, "long_axis_offset_mm": 0.5,
                   "aim_offset_mm": 0.5, "window_shift_mm": 25.0},
    "short_axis": {"section_deviation_deg": 0.5, "aim_offset_mm": 0.5,
                   "window_shift_mm": 25.0},
    # deliberate off-axis sweeps: only the aim point is guaranteed in plane
    "oblique":    {"aim_offset_mm": 0.5, "vessel_axis_offset_mm": 5.0},
    # vessel planes: the centreline must lie in the plane to within a few mm
    "vessel":     {"vessel_axis_offset_mm": 5.0, "aim_offset_mm": 6.0},
}


def load_module(name):
    """Read an ES module and strip its import/export syntax for QuickJS."""
    src = (SITE / "js" / name).read_text(encoding="utf8")
    src = re.sub(r"^\s*import[^;]*;\s*$", "", src, flags=re.M)
    src = re.sub(r"^\s*export\s*\{[^}]*\};\s*$", "", src, flags=re.M)
    src = re.sub(r"^\s*export\s+(function|const|let|class)", r"\1", src, flags=re.M)
    return src


def build_context():
    ctx = quickjs.Context()
    ctx.eval(load_module("geom.js"))
    ctx.eval(load_module("slicer.js"))
    ctx.eval("const ANAT = "
             + (SITE / "data" / "anatomy.json").read_text(encoding="utf8") + ";")
    ctx.eval("const STR = buildStructures(ANAT);")
    ctx.eval("""
    function visible(v){
      const res = sliceAll(STR, {origin:v.contact, u:v.index, v:v.beam, n:v.normal});
      const out = {seen:[], offscreen:[], area:{}};
      for (const r of res){
        const loops = r.outer.concat(r.cavity);
        if (loops.some(l => loopInSector(l, v.depth, v.sector))) out.seen.push(r.id);
        else out.offscreen.push(r.id);
        out.area[r.id] = +r.outer.reduce((s,l)=>s+Math.abs(area(l)),0).toFixed(3);
      }
      return JSON.stringify(out);
    }
    function triangleCount(){
      return [...STR.values()].reduce(
        (a,s)=>a+s.parts.reduce((b,p)=>b+p.tris.idx.length/3,0), 0);
    }
    """)
    return ctx


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", help="write a machine-readable report here")
    args = ap.parse_args()

    ctx = build_context()
    views = json.loads((SITE / "data" / "views.json").read_text(encoding="utf8"))
    n_struct = ctx.eval("STR.size")
    n_tri = ctx.eval("triangleCount()")

    report, failures = [], 0
    for v in views["views"]:
        got = json.loads(ctx.eval(f"visible({json.dumps(v)})"))
        seen = set(got["seen"])
        problems = []
        for e in v["expect"]:
            if e not in seen:
                problems.append(f"expected {e} not visible")
        for x in v["absent"]:
            if x in seen:
                problems.append(f"{x} should not be visible")
        for key, tol in TOL[v["family"]].items():
            val = v["metrics"].get(key)
            if val is not None and val > tol:
                problems.append(f"{key}={val} exceeds {tol}")
        if problems:
            failures += 1
        report.append({"id": v["id"], "name": v["name"], "window": v["window"],
                       "family": v["family"], "section": v["section"],
                       "clock_stated": v.get("clock_stated"),
                       "clock_computed": v.get("clock_computed"),
                       "index_toward": v["index_toward"],
                       "metrics": v["metrics"],
                       "n_visible": len(seen), "visible": sorted(seen),
                       "problems": problems,
                       "limitation": v.get("limitation")})

    w = max(len(r["id"]) for r in report)
    print(f"{n_struct} structures, {n_tri} triangles, {len(report)} views\n")
    print(f"{'view':{w}}  {'seen':>4}  status")
    print("-" * (w + 30))
    for r in report:
        status = "OK" if not r["problems"] else "; ".join(r["problems"])
        print(f"{r['id']:{w}}  {r['n_visible']:>4}  {status}")
    noted = [r for r in report if r["limitation"]]
    if noted:
        print("\nDocumented limitations of the idealised geometry:")
        for r in noted:
            print(f"  {r['id']}: {r['limitation']}")
    print(f"\n{len(report) - failures}/{len(report)} views pass")

    if args.json:
        pathlib.Path(args.json).write_text(json.dumps(
            {"n_structures": n_struct, "n_triangles": n_tri, "views": report},
            indent=1), encoding="utf8")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
