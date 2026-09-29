"""Execute the app's non-WebGL logic and cross-check its wiring.

No browser could be installed where this was built, so this stands in for one as
far as it can. Three passes:

  1. DOM contract - every element id app.js reaches for must exist in
     index.html, and every id in index.html that looks wired should be used.
  2. three.js contract - every THREE.* symbol scene3d.js uses must actually be
     exported by the vendored build, and the chained calls it relies on must
     return what it assumes.
  3. Runtime - load geom.js, slicer.js, body.js, probe.js and sector.js into
     QuickJS behind a stubbed 2-D canvas and really run them: build the
     anatomy, slice all 21 views, draw each one, and put the probe through
     every manoeuvre. Catches the undefined-property and bad-call errors that
     parsing cannot.

What it cannot check: WebGL rendering, three.js scene construction, layout,
and anything that needs real pixels.

Usage:  python tools/smoke_test.py
Exit code 0 if everything passes, 1 otherwise.
"""
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

failures = []


def check(label, ok, detail=""):
    print(f"  {'ok  ' if ok else 'FAIL'}  {label}{(' - ' + detail) if detail and not ok else ''}")
    if not ok:
        failures.append(f"{label}: {detail}")


# ------------------------------------------------------------- 1. DOM contract
def dom_contract():
    print("DOM contract")
    app = (SITE / "js" / "app.js").read_text(encoding="utf8")
    html = (SITE / "index.html").read_text(encoding="utf8")
    # ids reach the DOM three ways: $('#x') directly, and through the bind()
    # and toggle() helpers, which take the selector as a plain string
    wanted = set(re.findall(r"""['"]#([A-Za-z0-9_-]+)['"]""", app))
    # ids built by template literal, e.g. $(`#g-${g}`) and $(`#mode-${m}`)
    for tmpl, values in ((r"""\$\(`#g-\$\{g\}`\)""",
                          re.findall(r"for \(const g of \[([^\]]*)\]\)", app)),
                         (r"""\$\(`#mode-\$\{m\}`\)""", None)):
        pass
    for grp in re.findall(r"for \(const g of \[([^\]]*)\] *\) \{\n *const c = \$\(`#g-",
                          app):
        wanted |= {f"g-{x.strip().strip(chr(39))}" for x in grp.split(",")}
    wanted |= {f"mode-{m}" for m in ("guided", "free", "quiz")}
    wanted |= {f"panel-{m}" for m in ("guided", "free", "quiz")}
    present = set(re.findall(r"""\bid=["']([A-Za-z0-9_-]+)["']""", html))
    missing = sorted(wanted - present)
    check(f"{len(wanted)} ids referenced by app.js all exist in index.html",
          not missing, f"missing: {missing}")
    # ids in the html that app.js never touches. Layout-only ids are expected:
    # they exist for CSS and are never queried from script.
    layout_only = {"side-left", "side-right", "stages", "stage3d", "stage2d"}
    unused = sorted(present - wanted - layout_only)
    check("no orphan wired ids in index.html", not unused, f"unused: {unused}")


# --------------------------------------------------------- 2. three.js contract
def three_contract():
    print("three.js contract")
    scene = (SITE / "js" / "scene3d.js").read_text(encoding="utf8")
    three = (SITE / "js" / "vendor" / "three.module.js").read_text(encoding="utf8")
    core = (SITE / "js" / "vendor" / "three.core.js").read_text(encoding="utf8")
    used = sorted(set(re.findall(r"\bTHREE\.([A-Z]\w+)", scene)))
    # three.module.js re-exports from three.core.js; accept either
    exported = set()
    for src in (three, core):
        for blk in re.findall(r"export\s*\{([^}]*)\}", src, re.S):
            for part in blk.split(","):
                part = part.strip()
                if part:
                    exported.add(part.split(" as ")[-1].strip())
        exported |= set(re.findall(r"^export\s+(?:class|function|const)\s+(\w+)",
                                   src, re.M))
    missing = [u for u in used if u not in exported]
    check(f"{len(used)} THREE.* symbols used by scene3d.js are all exported",
          not missing, f"missing: {missing}")

    # the two chained calls scene3d.js depends on returning `this`
    cld = re.search(r"computeLineDistances\(\s*\)\s*\{(.{0,900}?)\n\t\}", core, re.S)
    check("Line.computeLineDistances() returns this (scene3d chains on it)",
          bool(cld and "return this" in cld.group(1)),
          "chained .computeLineDistances() would yield undefined")
    tri = re.search(r"triangulateShape\s*\(\s*contour\s*,\s*holes\s*\)", core)
    check("ShapeUtils.triangulateShape(contour, holes) signature matches", bool(tri))


# ----------------------------------------------------------------- 3. runtime
CANVAS_STUB = r"""
// Minimal 2-D canvas, enough to let sector.js run for real. It records the
// calls it receives so the test can assert that drawing actually happened
// rather than silently doing nothing.
var CALLS = {};
function ctxStub() {
  const rec = (n) => function () { CALLS[n] = (CALLS[n] || 0) + 1; };
  return {
    canvas: null,
    save: rec('save'), restore: rec('restore'),
    beginPath: rec('beginPath'), closePath: rec('closePath'),
    moveTo: rec('moveTo'), lineTo: rec('lineTo'), arc: rec('arc'),
    fill: rec('fill'), stroke: rec('stroke'), clip: rec('clip'),
    fillRect: rec('fillRect'), fillText: rec('fillText'),
    createPattern: function () { CALLS.createPattern = (CALLS.createPattern||0)+1;
                                 return {}; },
    createImageData: function (w, h) {
      CALLS.createImageData = (CALLS.createImageData || 0) + 1;
      return { data: new Array(w * h * 4).fill(0), width: w, height: h };
    },
    putImageData: rec('putImageData'),
    measureText: function (t) { return { width: 5.4 * String(t).length }; },
    globalCompositeOperation: 'source-over', globalAlpha: 1,
    font: '', fillStyle: '', strokeStyle: '', lineWidth: 1, textBaseline: '',
  };
}
var document = {
  createElement: function (tag) {
    return { width: 128, height: 128, getContext: function () { return ctxStub(); } };
  }
};
"""


def load_module(name, ctx):
    src = (SITE / "js" / name).read_text(encoding="utf8")
    src = re.sub(r"^\s*import[^;]*;\s*$", "", src, flags=re.M)
    src = re.sub(r"^\s*export\s*\{[^}]*\};\s*$", "", src, flags=re.M)
    src = re.sub(r"^\s*export\s+(function|const|let|class)", r"\1", src, flags=re.M)
    ctx.eval(src)


def runtime():
    print("runtime (stubbed canvas)")
    ctx = quickjs.Context()
    ctx.eval(CANVAS_STUB)
    for m in ("geom.js", "slicer.js", "body.js", "probe.js", "sector.js"):
        load_module(m, ctx)
    ctx.eval("const ANAT = "
             + (SITE / "data" / "anatomy.json").read_text(encoding="utf8") + ";")
    ctx.eval("const VIEWS = "
             + (SITE / "data" / "views.json").read_text(encoding="utf8") + ";")
    ctx.eval("const STR = buildStructures(ANAT);")
    check("anatomy builds", ctx.eval("STR.size") == len(json.loads(
        (SITE / "data" / "anatomy.json").read_text(encoding="utf8"))["structures"]))

    # draw every view through the real SectorView
    ctx.eval("""
    const cv = { width: 900, height: 700, getContext: function(){ return ctxStub(); } };
    const SV = new SectorView(cv);
    function drawAll(opts){
      Object.assign(SV.opts, opts || {});
      let n = 0;
      for (const v of VIEWS.views){
        const p = new Probe(v);
        const sl = sliceAll(STR, p.plane());
        SV.draw(sl, v, { highlight: new Set([v.expect[0]]) });
        n++;
      }
      return n;
    }""")
    n = ctx.eval("drawAll({speckle:true, labels:true, invert:false, grid:true})")
    check(f"SectorView.draw() ran for all {n} views", n == 21)
    n2 = ctx.eval("drawAll({speckle:false, labels:false, invert:true, grid:false})")
    check("draw() ran with every display option flipped", n2 == 21)
    calls = json.loads(ctx.eval("JSON.stringify(CALLS)"))
    check("drawing actually emitted geometry", calls.get("fill", 0) > 500,
          f"only {calls.get('fill', 0)} fill calls")
    check("labels were rendered", calls.get("fillText", 0) > 100,
          f"only {calls.get('fillText', 0)} fillText calls")
    check("speckle pattern was built", calls.get("createPattern", 0) > 0)

    # put the probe through every manoeuvre, from every view
    ctx.eval("""
    function exerciseProbe(){
      let worst = 0, checks = 0;
      for (const v of VIEWS.views){
        const p = new Probe(v);
        // a pose straight off the view must be on-plane
        const d0 = p.deviation(v);
        if (d0.plane_deg > worst) worst = d0.plane_deg;
        checks++;
        // rocking must NOT change the imaging plane
        const before = p.plane().n.slice();
        p.rock(12);
        const after = p.plane().n;
        const drift = Math.max(...[0,1,2].map(k => Math.abs(before[k]-after[k])));
        if (drift > 1e-9) throw new Error('rock changed the plane for ' + v.id);
        // sweeping MUST change it
        p.sweep(10);
        const swept = p.plane().n;
        const moved = Math.max(...[0,1,2].map(k => Math.abs(before[k]-swept[k])));
        if (moved < 1e-6) throw new Error('sweep did not change the plane for ' + v.id);
        // rotate, slide, depth, advice, nearest must all run
        p.rotate(-15).rotate(15).slide(0.4, -0.3).setDepth(7.5);
        if (typeof p.advice(v) !== 'string') throw new Error('advice for ' + v.id);
        const nr = p.nearest(VIEWS.views);
        if (!nr || !nr.view) throw new Error('nearest for ' + v.id);
        // and the slicer must still cope with the perturbed pose
        sliceAll(STR, p.plane());
      }
      return [checks, worst];
    }""")
    try:
        checks, worst = json.loads(ctx.eval("JSON.stringify(exerciseProbe())"))
        check(f"probe manoeuvres ran for all {checks} views", checks == 21)
        check("rock() leaves the plane unchanged, sweep() changes it", True)
        check("loaded poses sit on their own plane", worst < 0.05,
              f"worst deviation {worst} deg")
    except Exception as e:                                   # noqa: BLE001
        check("probe manoeuvres", False, str(e))

    # sector visibility helpers used by the app's readout
    ctx.eval("""
    function visCounts(){
      const out = [];
      for (const v of VIEWS.views){
        const p = new Probe(v);
        out.push(visibleIds(STR, p.plane(), v.depth, v.sector).size);
      }
      return out;
    }""")
    counts = json.loads(ctx.eval("JSON.stringify(visCounts())"))
    check("visibleIds() returns a non-empty set for every view",
          all(c > 0 for c in counts), f"counts: {counts}")


def main():
    dom_contract()
    three_contract()
    runtime()
    print()
    if failures:
        print(f"{len(failures)} check(s) FAILED")
        for f in failures:
            print("  -", f)
        return 1
    print("all checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
