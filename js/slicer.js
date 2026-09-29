// slicer.js - exact cross-section of the anatomy by an imaging plane.
//
// This is the core of the rebuild.  Rather than relying on GPU clipping (which
// leaves a chamber looking like a hollow shell), we intersect the actual
// triangles with the plane, chain the resulting segments into closed loops, and
// express them in the plane's own 2-D coordinates.
//
// The same loops then serve two purposes:
//   * filled as polygons in 3-D, they become the solid cut surface;
//   * drawn in the plane's 2-D frame, they become the echo sector image.
// One computation, so the 3-D cut and the 2-D image can never disagree.
//
// Plane convention, shared with data/views.json:
//   origin = transducer contact point on the skin
//   u      = index-mark direction  -> +x in the image (image RIGHT)
//   v      = beam direction        -> +y in the image (increasing DEPTH)
//   n      = u x v                 -> plane normal

const EPS = 1e-9;

/** Intersect a triangle soup with a plane; return unordered 3-D segments. */
function planeSegments(tris, origin, n) {
  const { pos, idx } = tris;
  const segs = [];
  const d = new Float64Array(pos.length / 3);
  for (let i = 0, k = 0; i < pos.length; i += 3, k++) {
    d[k] = (pos[i] - origin[0]) * n[0] + (pos[i + 1] - origin[1]) * n[1]
         + (pos[i + 2] - origin[2]) * n[2];
  }
  const lerp = (a, b) => {
    const t = d[a] / (d[a] - d[b]);
    return [pos[a * 3] + (pos[b * 3] - pos[a * 3]) * t,
            pos[a * 3 + 1] + (pos[b * 3 + 1] - pos[a * 3 + 1]) * t,
            pos[a * 3 + 2] + (pos[b * 3 + 2] - pos[a * 3 + 2]) * t];
  };
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    const da = d[a], db = d[b], dc = d[c];
    // classify: how many vertices lie on the positive side
    const pa = da > 0, pb = db > 0, pc = dc > 0;
    if (pa === pb && pb === pc) continue;            // triangle misses the plane
    const pts = [];
    if (pa !== pb) pts.push(lerp(a, b));
    if (pb !== pc) pts.push(lerp(b, c));
    if (pc !== pa) pts.push(lerp(c, a));
    if (pts.length === 2) segs.push(pts[0], pts[1]);
  }
  return segs;
}

/** Project 3-D points into the plane's 2-D (u, v) frame, in cm. */
function project(p, origin, u, v) {
  const x = p[0] - origin[0], y = p[1] - origin[1], z = p[2] - origin[2];
  return [x * u[0] + y * u[1] + z * u[2], x * v[0] + y * v[1] + z * v[2]];
}

/**
 * Chain 2-D segments into closed loops.
 * Endpoints are quantised so that triangles sharing an edge agree on their
 * shared intersection point; without this the loops never close.
 */
function chainLoops(segs2, tol = 2e-4) {
  const key = (p) => `${Math.round(p[0] / tol)},${Math.round(p[1] / tol)}`;
  const adj = new Map();
  const addEdge = (a, b) => {
    const ka = key(a), kb = key(b);
    if (ka === kb) return;
    if (!adj.has(ka)) adj.set(ka, { p: a, to: [] });
    if (!adj.has(kb)) adj.set(kb, { p: b, to: [] });
    adj.get(ka).to.push(kb);
    adj.get(kb).to.push(ka);
  };
  for (let i = 0; i < segs2.length; i += 2) addEdge(segs2[i], segs2[i + 1]);

  const loops = [];
  const used = new Set();
  for (const start of adj.keys()) {
    if (used.has(start)) continue;
    const loop = [];
    let cur = start, prev = null, guard = 0;
    while (cur && !used.has(cur) && guard++ < 200000) {
      used.add(cur);
      loop.push(adj.get(cur).p);
      const nbrs = adj.get(cur).to.filter((k) => k !== prev && !used.has(k));
      prev = cur;
      cur = nbrs.length ? nbrs[0] : null;
    }
    if (loop.length >= 3) loops.push(loop);
  }
  return loops;
}

const area = (loop) => {
  let a = 0;
  for (let i = 0, n = loop.length; i < n; i++) {
    const p = loop[i], q = loop[(i + 1) % n];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
};

function pointInLoop(pt, loop) {
  let inside = false;
  for (let i = 0, n = loop.length, j = n - 1; i < n; j = i++) {
    const a = loop[i], b = loop[j];
    if (((a[1] > pt[1]) !== (b[1] > pt[1]))
      && (pt[0] < (b[0] - a[0]) * (pt[1] - a[1]) / (b[1] - a[1] + EPS) + a[0])) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Slice every structure with one plane.
 *
 * plane = { origin:[x,y,z], u:[..], v:[..], n:[..] }
 * Returns an array (in paint order) of
 *   { id, label, group, tissue, outer:[loop..], cavity:[loop..], cut:boolean }
 * where each loop is an array of [x, y] in plane centimetres: x along the
 * index-mark axis, y along the beam (depth).
 */
export function sliceAll(structures, plane, order) {
  const { origin, u, v, n } = plane;
  const res = [];
  const ids = order || [...structures.keys()];
  for (const id of ids) {
    const s = structures.get(id);
    if (!s) continue;
    const rec = { id, label: s.label, group: s.group, tissue: s.tissue,
                  outer: [], cavity: [], cut: false };
    for (const part of s.parts) {
      const segs = planeSegments(part.tris, origin, n);
      if (!segs.length) continue;
      const segs2 = segs.map((p) => project(p, origin, u, v));
      const loops = chainLoops(segs2).filter((l) => Math.abs(area(l)) > 1e-4);
      if (!loops.length) continue;
      rec.cut = true;
      if (part.role === 'cavity') rec.cavity.push(...loops);
      else rec.outer.push(...loops);
    }
    if (rec.cut) res.push(rec);
  }
  return res;
}

// ------------------------------------------------------------------- sector
// A real echo image is not an infinite plane but a wedge: it starts at the
// transducer face, spreads over the sector angle and stops at the depth
// setting.  Structures the plane happens to cross outside that wedge are not
// on the screen, so "what this view shows" has to be judged inside the sector.

/** Is any part of this loop inside the sector wedge? */
export function loopInSector(loop, depth, sectorDeg) {
  const half = (sectorDeg * Math.PI) / 360;
  for (const p of loop) {
    const r = Math.hypot(p[0], p[1]);
    if (r <= depth && p[1] > 0 && Math.abs(Math.atan2(p[0], p[1])) <= half) {
      return true;
    }
  }
  return false;
}

/** Clip a loop to the sector wedge by sampling; returns the retained runs. */
export function clipToSector(loop, depth, sectorDeg) {
  const half = (sectorDeg * Math.PI) / 360;
  const inside = (p) => {
    const r = Math.hypot(p[0], p[1]);
    return r <= depth && p[1] > 0 && Math.abs(Math.atan2(p[0], p[1])) <= half;
  };
  const runs = [];
  let cur = [];
  for (let i = 0; i <= loop.length; i++) {
    const p = loop[i % loop.length];
    if (inside(p)) cur.push(p);
    else if (cur.length) { runs.push(cur); cur = []; }
  }
  if (cur.length) runs.push(cur);
  return runs;
}

/**
 * Which structures does this view actually show?
 * Pass depth/sector to restrict the answer to the sector wedge, which is what
 * appears on the screen.  Used by the verification pass and the label layer.
 */
export function visibleIds(structures, plane, depth, sectorDeg) {
  const out = new Set();
  for (const r of sliceAll(structures, plane)) {
    const loops = r.outer.concat(r.cavity);
    if (depth == null) { out.add(r.id); continue; }
    if (loops.some((l) => loopInSector(l, depth, sectorDeg))) out.add(r.id);
  }
  return out;
}

export { chainLoops, project, area, pointInLoop, planeSegments };
