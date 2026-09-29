// geom.js - tessellate the analytic anatomy primitives into triangle meshes.
//
// Every cardiac structure in data/anatomy.json is declared analytically (an
// ellipsoid shell, a swept tube, or a thin disc).  This module turns each
// declaration into a flat world-space triangle array, used both for rendering
// (wrapped into three.js buffers by meshes.js) and for slicing.  Both come from
// the same primitive, so the 3-D cut and the 2-D sector can never disagree.
//
// Shells and tubes are built closed, so a plane cutting one always produces
// closed contour loops - which is what lets the cut surface be filled as solid
// tissue instead of appearing as a hollow shell.

// Deliberately free of any three.js import: this module is pure arithmetic on
// plain arrays, so the anatomy and the slicing maths can be exercised outside a
// browser.  The three.js wrapping lives in meshes.js.

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1],
                         a[2] * b[0] - a[0] * b[2],
                         a[0] * b[1] - a[1] * b[0]];
const norm = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => { const n = norm(a) || 1; return [a[0] / n, a[1] / n, a[2] / n]; };
const V = (a) => [a[0], a[1], a[2]];

/**
 * Centripetal Catmull-Rom through the control points, matching the curve used
 * to author the great vessels.  Returns position at t in [0,1].
 */
function catmullRom(pts, t) {
  const n = pts.length;
  if (n === 2) return add(mul(pts[0], 1 - t), mul(pts[1], t));
  const x = t * (n - 1);
  let i = Math.min(n - 2, Math.floor(x));
  const f = x - i;
  const p0 = pts[Math.max(0, i - 1)], p1 = pts[i];
  const p2 = pts[i + 1], p3 = pts[Math.min(n - 1, i + 2)];
  const f2 = f * f, f3 = f2 * f;
  const out = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    const m1 = 0.5 * (p2[k] - p0[k]);
    const m2 = 0.5 * (p3[k] - p1[k]);
    out[k] = (2 * f3 - 3 * f2 + 1) * p1[k] + (f3 - 2 * f2 + f) * m1
           + (-2 * f3 + 3 * f2) * p2[k] + (f3 - f2) * m2;
  }
  return out;
}

/** Rotation-minimising (double-reflection) frames along a sampled curve. */
function frames(samples) {
  const N = samples.length;
  const tan = samples.map((_, i) => unit(sub(
    samples[Math.min(N - 1, i + 1)], samples[Math.max(0, i - 1)])));
  const seed = Math.abs(tan[0][0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const nrm = [unit(cross(tan[0], seed))];
  for (let i = 1; i < N; i++) {
    // parallel-transport the normal along the curve
    let nx = sub(nrm[i - 1], mul(tan[i], dot(nrm[i - 1], tan[i])));
    if (norm(nx) < 1e-8) nx = cross(tan[i], seed);
    nrm.push(unit(nx));
  }
  return { tan, nrm, bin: tan.map((t, i) => unit(cross(t, nrm[i]))) };
}

// ---------------------------------------------------------------- ellipsoid
// Unit sphere sampled on a lat/long grid, then scaled by the three radii and
// rotated into the structure's own axes.  Closed: poles are capped by the
// triangle fan, seam vertices are duplicated so UV/normals stay sane.
function ellipsoid(centre, axes, radii, nu = 36, nv = 22) {
  const pos = [], idx = [];
  const [ax, ay, az] = axes.map(V);
  const c = V(centre);
  for (let j = 0; j <= nv; j++) {
    const th = (j / nv) * Math.PI;           // 0..pi  (pole to pole)
    const st = Math.sin(th), ct = Math.cos(th);
    for (let i = 0; i <= nu; i++) {
      const ph = (i / nu) * Math.PI * 2;
      const x = st * Math.cos(ph) * radii[0];
      const y = st * Math.sin(ph) * radii[1];
      const z = ct * radii[2];
      pos.push(c[0] + ax[0] * x + ay[0] * y + az[0] * z,
               c[1] + ax[1] * x + ay[1] * y + az[1] * z,
               c[2] + ax[2] * x + ay[2] * y + az[2] * z);
    }
  }
  const row = nu + 1;
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const a = j * row + i, b = a + row;
      if (j !== 0) idx.push(a, b, a + 1);
      if (j !== nv - 1) idx.push(b, b + 1, a + 1);
    }
  }
  return { pos: new Float32Array(pos), idx: new Uint32Array(idx) };
}

// --------------------------------------------------------------------- tube
// Circular cross-section swept along a Catmull-Rom spline through the path,
// with a per-control-point radius taper, capped flat at both ends so the solid
// is closed.
function tube(path, radius, taper, nSeg = 48, nRad = 16) {
  const pos = [], idx = [];
  const samples = [];
  for (let s = 0; s <= nSeg; s++) samples.push(catmullRom(path, s / nSeg));
  const fr = frames(samples);
  const rAt = (t) => {
    const x = t * (taper.length - 1), i = Math.min(taper.length - 2, Math.floor(x));
    return radius * (taper[i] + (taper[i + 1] - taper[i]) * (x - i));
  };
  for (let s = 0; s <= nSeg; s++) {
    const P = samples[s], r = rAt(s / nSeg);
    const N = fr.nrm[s], B = fr.bin[s];
    for (let k = 0; k < nRad; k++) {
      const a = (k / nRad) * Math.PI * 2;
      const ca = Math.cos(a) * r, sa = Math.sin(a) * r;
      pos.push(P[0] + N[0] * ca + B[0] * sa,
               P[1] + N[1] * ca + B[1] * sa,
               P[2] + N[2] * ca + B[2] * sa);
    }
  }
  for (let s = 0; s < nSeg; s++) {
    for (let k = 0; k < nRad; k++) {
      const a = s * nRad + k, b = s * nRad + (k + 1) % nRad;
      idx.push(a, b, a + nRad, b, b + nRad, a + nRad);
    }
  }
  // flat end caps, so the swept solid is closed
  for (const [s, flip] of [[0, true], [nSeg, false]]) {
    const P = samples[s];
    const ci = pos.length / 3;
    pos.push(P[0], P[1], P[2]);
    for (let k = 0; k < nRad; k++) {
      const a = s * nRad + k, b = s * nRad + (k + 1) % nRad;
      if (flip) idx.push(ci, b, a); else idx.push(ci, a, b);
    }
  }
  return { pos: new Float32Array(pos), idx: new Uint32Array(idx), samples };
}

// --------------------------------------------------------------------- disc
// Thin closed cylinder - used for valve planes, which need to be visible in
// cross-section but have negligible thickness.
function disc(centre, normal, r, thick, nRad = 24) {
  const n = unit(V(normal));
  const seed = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const t1 = unit(cross(n, seed));
  const t2 = unit(cross(n, t1));
  const c = V(centre), h = thick / 2;
  const pos = [], idx = [];
  for (const sgn of [-1, 1]) {
    const o = add(c, mul(n, sgn * h));
    const ci = pos.length / 3;
    pos.push(o[0], o[1], o[2]);
    for (let k = 0; k < nRad; k++) {
      const a = (k / nRad) * Math.PI * 2;
      const ca = Math.cos(a) * r, sa = Math.sin(a) * r;
      pos.push(o[0] + t1[0] * ca + t2[0] * sa,
               o[1] + t1[1] * ca + t2[1] * sa,
               o[2] + t1[2] * ca + t2[2] * sa);
    }
    for (let k = 0; k < nRad; k++) {
      const a = ci + 1 + k, b = ci + 1 + (k + 1) % nRad;
      if (sgn < 0) idx.push(ci, b, a); else idx.push(ci, a, b);
    }
  }
  const top = 0, bot = nRad + 1;
  for (let k = 0; k < nRad; k++) {
    const a0 = top + 1 + k, a1 = top + 1 + (k + 1) % nRad;
    const b0 = bot + 1 + k, b1 = bot + 1 + (k + 1) % nRad;
    idx.push(a0, a1, b0, a1, b1, b0);
  }
  return { pos: new Float32Array(pos), idx: new Uint32Array(idx) };
}

// ----------------------------------------------------------------- crescent
/**
 * A lofted crescent wrapped around an ellipsoid - the shape of the right
 * ventricle against the left, and of the interventricular septum.
 *
 * The RV is not an ellipsoid: in short axis it is a crescent hugging the
 * circular LV, which is why the parasternal short axis shows a D-shaped LV
 * with the RV draped over one side.  Modelling it as an ellipsoid makes every
 * long-axis cut wrong, so it is built here as a true swept crescent.
 *
 * host   = { centre, axes:[e1,e2,e3], radii:[r1,r2,r3] } the ellipsoid it hugs
 * span   = [a0, a1] angular extent in degrees, measured from +e1 toward +e2
 * sRange = [s0, s1] extent along e3 as a fraction of r3 (-1 = apical pole)
 * off0/off1 = inner and outer offset from the host surface, as functions
 *             (s, w) -> centimetres, where w in [0,1] runs across the span
 */
function crescent(host, span, sRange, off0, off1, nu = 40, nv = 28) {
  const c = V(host.centre);
  const [e1, e2, e3] = host.axes.map(V);
  const [r1, r2, r3] = host.radii;
  const a0 = span[0] * Math.PI / 180, a1 = span[1] * Math.PI / 180;
  const pos = [], idx = [];

  const surf = (s, w, off) => {
    const phi = a0 + (a1 - a0) * w;
    const k = Math.sqrt(Math.max(0, 1 - s * s));
    const cp = Math.cos(phi), sp = Math.sin(phi);
    // point on the host ellipsoid
    const x = r1 * k * cp, y = r2 * k * sp, z = r3 * s;
    // outward normal of the ellipsoid at that point
    const g = unit([cp / r1, sp / r2, 0]);
    const d = off(s, w);
    const lx = x + g[0] * d, ly = y + g[1] * d, lz = z + g[2] * d;
    return [c[0] + e1[0] * lx + e2[0] * ly + e3[0] * lz,
            c[1] + e1[1] * lx + e2[1] * ly + e3[1] * lz,
            c[2] + e1[2] * lx + e2[2] * ly + e3[2] * lz];
  };

  // two sheets: inner (off0) then outer (off1)
  const sheet = (off) => {
    const base = pos.length / 3;
    for (let j = 0; j <= nv; j++) {
      const s = sRange[0] + (sRange[1] - sRange[0]) * (j / nv);
      for (let i = 0; i <= nu; i++) {
        const p = surf(s, i / nu, off);
        pos.push(p[0], p[1], p[2]);
      }
    }
    return base;
  };
  const A = sheet(off0), B = sheet(off1);
  const row = nu + 1;
  const quad = (p, q, r, s2) => idx.push(p, q, r, q, s2, r);
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      // inner sheet faces inward, outer sheet faces outward
      quad(A + j * row + i, A + j * row + i + 1,
           A + (j + 1) * row + i, A + (j + 1) * row + i + 1);
      quad(B + j * row + i, B + (j + 1) * row + i,
           B + j * row + i + 1, B + (j + 1) * row + i + 1);
    }
  }
  // close the four boundaries so the crescent is a solid
  for (let i = 0; i < nu; i++) {                       // s = s0 and s = s1 rims
    quad(A + i, B + i, A + i + 1, B + i + 1);
    const t = nv * row;
    quad(A + t + i, A + t + i + 1, B + t + i, B + t + i + 1);
  }
  for (let j = 0; j < nv; j++) {                       // the two crescent tips
    quad(A + j * row, A + (j + 1) * row, B + j * row, B + (j + 1) * row);
    quad(A + j * row + nu, B + j * row + nu,
         A + (j + 1) * row + nu, B + (j + 1) * row + nu);
  }
  return { pos: new Float32Array(pos), idx: new Uint32Array(idx) };
}

/**
 * Build every structure declared in anatomy.json.
 * Returns a Map id -> {
 *   id, label, group, tissue,
 *   parts: [ { role:'outer'|'cavity'|'solid', geometry, tris:{pos,idx} } ]
 * }
 * `role` is what lets the slicer know which contour loops are myocardium and
 * which are blood pool, without any geometric guessing.
 */
export function buildStructures(anatomy) {
  const out = new Map();
  for (const s of anatomy.structures) {
    const parts = [];
    if (s.kind === 'shell') {
      parts.push({ role: 'outer', tris: ellipsoid(s.centre, s.axes, s.radii) });
      if (s.cavity && s.cavity.some((v) => v > 0.05)) {
        parts.push({ role: 'cavity', tris: ellipsoid(s.centre, s.axes, s.cavity) });
      }
    } else if (s.kind === 'tube') {
      const o = tube(s.path, s.radius, s.taper);
      parts.push({ role: 'outer', tris: o, samples: o.samples });
      if (s.wall > 0 && s.wall < s.radius) {
        const lumenTaper = s.taper.map((t) => t * (1 - s.wall / s.radius));
        parts.push({ role: 'cavity', tris: tube(s.path, s.radius, lumenTaper) });
      }
    } else if (s.kind === 'disc') {
      parts.push({ role: 'solid', tris: disc(s.centre, s.normal, s.radius, s.thick) });
    } else if (s.kind === 'crescent') {
      // depth tapers to zero at both crescent tips and along the long axis,
      // so the tips close onto the host ellipsoid the way the RV does.
      const prof = (dMax) => (sv, w) => {
        const across = Math.sin(Math.PI * Math.min(1, Math.max(0, w)));
        const along = Math.pow(Math.max(0, 1 - Math.pow(
          Math.abs(sv - s.peak) / s.reach, 2)), 0.65);
        return s.gap + dMax * across * along;
      };
      const host = { centre: s.host.centre, axes: s.host.axes,
                     radii: s.host.radii };
      parts.push({ role: 'outer',
                   tris: crescent(host, s.span, s.sRange,
                                  prof(0), prof(s.depth + s.wall)) });
      if (s.depth > 0) {
        parts.push({ role: 'cavity',
                     tris: crescent(host, s.span, s.sRange,
                                    prof(0), prof(s.depth)) });
      }
    }
    out.set(s.id, {
      id: s.id, label: s.label, group: s.group, tissue: s.tissue, parts,
    });
  }
  return out;
}

export { ellipsoid, tube, disc, catmullRom, frames,
         add, sub, mul, dot, cross, norm, unit };
