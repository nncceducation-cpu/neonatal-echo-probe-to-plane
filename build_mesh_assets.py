"""Register the BodyParts3D heart onto the neonatal patient frame and emit site assets.

Input   mesh_src/Me-TEE-Meshes-main/           (17 hole-sealed heart/great-vessel OBJs)
Output  site/data/heart.bin                    packed Float32 positions + Uint32 indices
        site/data/heart_meta.json              per-structure offsets, names, groups
        site/data/chambers.bin                 uint8 chamber label grid + header
        site/data/frame.json                   derived cardiac frame, valves, torso

Everything is derived from the meshes; no cardiac geometry is hand-entered.  The one
externally fixed number is the neonatal LV long axis (LONG_AXIS_CM), which sets scale.

Attribution: the anatomical meshes are BodyParts3D, (c) Database Center for Life
Science (DBCLS), licensed CC BY-SA 2.1 Japan.
"""
import json, os, struct, sys
import numpy as np

ROOT = "mesh_src/Me-TEE-Meshes-main"
OUT = "site/data" if os.path.isdir("site/data") else "data"
LONG_AXIS_CM = 3.3738          # term-newborn LV apex -> mitral annulus
A_T, C_T = 5.25, 4.60          # torso semi-axes, cm (transverse 10.5, AP 9.2)
ZC_T = 0.75 - C_T              # mid-sternum skin held at z = +0.75
WALL = 0.60                    # chest wall thickness, skin -> mediastinum
H = 0.045                      # voxel edge for chamber labelling, cm
CODE = {"outside": 1, "lv": 2, "rv": 3, "la": 4, "ra": 5}

unit = lambda v: np.asarray(v, float) / np.linalg.norm(np.asarray(v, float))


def load_obj(path):
    V, F = [], []
    with open(path) as fh:
        for ln in fh:
            if ln.startswith("v "):
                V.append([float(x) for x in ln.split()[1:4]])
            elif ln.startswith("f "):
                idx = [int(t.split("/")[0]) for t in ln.split()[1:]]
                for k in range(1, len(idx) - 1):
                    F.append([idx[0] - 1, idx[k] - 1, idx[k + 1] - 1])
    return np.asarray(V, float), np.asarray(F, np.int32)


def area_centroid(V, F):
    a, b, c = V[F[:, 0]], V[F[:, 1]], V[F[:, 2]]
    ar = 0.5 * np.linalg.norm(np.cross(b - a, c - a), axis=1)
    return ((a + b + c) / 3.0 * ar[:, None]).sum(0) / ar.sum()


def skin_z(x):
    """Anterior skin z at transverse offset x (cm)."""
    xa = np.clip(np.asarray(x, float) / A_T, -0.999, 0.999)
    return ZC_T + C_T * np.sqrt(1 - xa ** 2)


def in_torso(P, inset):
    """Inside the trunk, shrunk by `inset` cm, and within the modelled y range."""
    s = np.where(P[:, 1] < -6.6, 0.93, 1.0)
    a = A_T * s - inset
    c = C_T * s - inset
    return ((P[:, 0] / a) ** 2 + ((P[:, 2] - ZC_T) / c) ** 2 <= 1.0) & (P[:, 1] > -9.0) & (P[:, 1] < 1.3)


def boundary_loops(F):
    """Ordered vertex loops along edges used by exactly one triangle."""
    cnt, nxt = {}, {}
    for t in F:
        for u, v in ((t[0], t[1]), (t[1], t[2]), (t[2], t[0])):
            key = (min(u, v), max(u, v))
            cnt[key] = cnt.get(key, 0) + 1
            nxt.setdefault(key, []).append((u, v))
    adj = {}
    for key, n in cnt.items():
        if n != 1:
            continue
        u, v = nxt[key][0]
        adj.setdefault(u, []).append(v)
    loops, seen = [], set()
    for start in list(adj):
        if start in seen:
            continue
        loop, cur = [], start
        while cur in adj and cur not in seen:
            seen.add(cur)
            loop.append(cur)
            cand = [w for w in adj[cur] if w not in seen]
            if not cand:
                break
            cur = cand[0]
        if len(loop) >= 3:
            loops.append(loop)
    return loops


def clip_and_seal(V, F, keep_vertex):
    """Drop triangles outside the kept region, then cap each open boundary."""
    kv = keep_vertex(V)
    keep = kv[F].all(axis=1)
    F2 = F[keep]
    if len(F2) == 0:
        return V[:0], F2
    used = np.unique(F2)
    remap = -np.ones(len(V), np.int64)
    remap[used] = np.arange(len(used))
    V2 = V[used].copy()
    F2 = remap[F2]
    caps, Vx = [], [V2]
    base = len(V2)
    for loop in boundary_loops(F2):
        ring = V2[loop]
        ctr = ring.mean(0)
        Vx.append(ctr[None, :])
        ci = base
        base += 1
        for k in range(len(loop)):
            caps.append([loop[k], loop[(k + 1) % len(loop)], ci])
    if caps:
        V2 = np.vstack(Vx)
        F2 = np.vstack([F2, np.asarray(caps, np.int32)])
    return V2, F2


def components(V, F):
    parent = np.arange(len(V))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for t in F:
        r = find(t[0])
        for q in t[1:]:
            q = find(q)
            if q != r:
                parent[q] = r
    roots = np.array([find(i) for i in range(len(V))])
    out = []
    for r in np.unique(roots):
        vs = np.where(roots == r)[0]
        if len(vs) < 30:
            continue
        remap = -np.ones(len(V), np.int64)
        remap[vs] = np.arange(len(vs))
        sel = np.isin(F[:, 0], vs)
        out.append((V[vs].copy(), remap[F[sel]]))
    return out


def valve_funnel(centre, axis, radius, cusps=3, nu=48, nv=10, thick=0.022, depth=0.34):
    """Thin tri-leaflet funnel, used only for the aortic valve (absent from the atlas)."""
    axis = unit(axis)
    ref = np.array([0.0, 0.0, 1.0])
    if abs(ref @ axis) > 0.9:
        ref = np.array([1.0, 0.0, 0.0])
    e1 = unit(np.cross(axis, ref))
    e2 = np.cross(axis, e1)
    V, F = [], []
    for side, off in ((0, +thick / 2), (1, -thick / 2)):
        for j in range(nv + 1):
            t = j / nv
            scal = 1.0 - 0.30 * t * (1.0 + np.cos(cusps * np.linspace(0, 2 * np.pi, nu, endpoint=False)))/2.0
            r = radius * (0.62 + 0.38 * (1 - t)) * scal
            for i in range(nu):
                th = 2 * np.pi * i / nu
                p = centre + (r[i] + off) * (np.cos(th) * e1 + np.sin(th) * e2) - depth * radius * t * axis
                V.append(p)
    n = (nv + 1) * nu
    for side in (0, 1):
        b = side * n
        for j in range(nv):
            for i in range(nu):
                a0 = b + j * nu + i
                a1 = b + j * nu + (i + 1) % nu
                a2 = b + (j + 1) * nu + i
                a3 = b + (j + 1) * nu + (i + 1) % nu
                F += [[a0, a2, a1], [a1, a2, a3]] if side == 0 else [[a0, a1, a2], [a1, a3, a2]]
    for j in (0, nv):                                    # rims
        for i in range(nu):
            a0 = j * nu + i
            a1 = j * nu + (i + 1) % nu
            F += [[a0, a1, a0 + n], [a1, a1 + n, a0 + n]]
    return np.asarray(V, float), np.asarray(F, np.int32)


def voxel_inside(V, F, lo, dims):
    """Solid voxelisation by +X ray parity, rasterising each triangle on the (y,z) lattice."""
    tri = V[F]
    a, b, c = tri[:, 0], tri[:, 1], tri[:, 2]
    e1, e2 = b - a, c - a
    ys = np.arange(dims[1]) * H + lo[1]
    zs = np.arange(dims[2]) * H + lo[2]
    jmn = np.ceil((tri[:, :, 1].min(1) - lo[1]) / H).astype(int)
    jmx = np.floor((tri[:, :, 1].max(1) - lo[1]) / H).astype(int)
    kmn = np.ceil((tri[:, :, 2].min(1) - lo[2]) / H).astype(int)
    kmx = np.floor((tri[:, :, 2].max(1) - lo[2]) / H).astype(int)
    cols = {}
    for ti in range(len(tri)):
        d = e1[ti, 1] * e2[ti, 2] - e1[ti, 2] * e2[ti, 1]
        if d == 0:
            continue
        for j in range(max(jmn[ti], 0), min(jmx[ti], dims[1] - 1) + 1):
            py = ys[j] - a[ti, 1]
            for k in range(max(kmn[ti], 0), min(kmx[ti], dims[2] - 1) + 1):
                pz = zs[k] - a[ti, 2]
                u = (py * e2[ti, 2] - pz * e2[ti, 1]) / d
                v = (-py * e1[ti, 2] + pz * e1[ti, 1]) / d
                if u < 0 or v < 0 or u + v > 1:
                    continue
                cols.setdefault((j, k), []).append(a[ti, 0] + u * e1[ti, 0] + v * e2[ti, 0])
    inside = np.zeros(dims, bool)
    ii = np.arange(dims[0]) * H + lo[0]
    odd = 0
    for (j, k), xs in cols.items():
        xs = np.sort(np.asarray(xs))
        if len(xs) % 2:
            odd += 1
            continue
        for m in range(0, len(xs), 2):
            inside[(ii >= xs[m]) & (ii <= xs[m + 1]), j, k] = True
    return inside, odd


def main():
    man = json.load(open(os.path.join(ROOT, "Assets/HeartMeshes/manifest.json")))
    raw = {s["id"]: load_obj(os.path.join(ROOT, "obj", s["id"] + ".obj")) for s in man["structures"]}
    name = {s["id"]: s["name"] for s in man["structures"]}

    # ---- cardiac frame in atlas space -------------------------------------
    Vw, Fw = raw["FMA7274"]
    mv_m = area_centroid(*raw["FMA7235"])
    tv_m = area_centroid(*raw["FMA7234"])
    pap = 0.5 * (area_centroid(*raw["FMA7266"]) + area_centroid(*raw["FMA9352nsn"]))
    d = unit(pap - mv_m)
    apex_m = Vw[np.argmax((Vw - mv_m) @ d)]
    for _ in range(6):
        d = unit(apex_m - mv_m)
        apex_m = Vw[np.argmax((Vw - mv_m) @ d)]
    L_m = np.linalg.norm(mv_m - apex_m)

    # ---- atlas body axes -> patient body axes; scale by the neonatal long axis
    R = np.array([[1.0, 0, 0], [0, 0, 1.0], [0, -1.0, 0]])   # x=left, y=post, z=sup
    SCALE = LONG_AXIS_CM / L_m

    def place(t):
        return lambda P: (np.array([3.05, 0.0, 0.0]) + t) + SCALE * (np.atleast_2d(np.asarray(P, float)) - apex_m) @ R.T

    def resid(t):
        xf = place(t)
        V = xf(Vw)
        ap = xf(apex_m)[0]
        e = np.array([ap[0] - 3.05,
                      (skin_z(ap[0]) - 0.70) - ap[2],
                      np.percentile(V[:, 1], 0.5) - (-4.90),
                      (skin_z(1.20) - 0.65) - np.percentile(V[:, 2], 99.5),
                      np.percentile(V[:, 0], 2.0) - (-1.60)])
        return np.array([6.0, 6.0, 3.0, 6.0, 1.5]) * e, e

    t = np.zeros(3)
    for _ in range(400):
        f0, _e = resid(t)
        J = np.zeros((5, 3))
        for k in range(3):
            dd = np.zeros(3); dd[k] = 1e-3
            J[:, k] = (resid(t + dd)[0] - f0) / 1e-3
        step = np.linalg.lstsq(J, -f0, rcond=None)[0]
        t = t + 0.6 * step
        if np.linalg.norm(step) < 1e-7:
            break
    xf = place(t)
    _, fit_resid = resid(t)

    W = {k: xf(v[0]) for k, v in raw.items()}
    Vh = W["FMA7274"]
    apex = xf(apex_m)[0]
    mv = xf(mv_m)[0]
    tv = xf(tv_m)[0]
    pvc = xf(area_centroid(*raw["FMA7246"]))[0]
    eL = unit(mv - apex)
    u = tv - mv
    p1 = -unit(u - (u @ eL) * eL)
    p2 = np.cross(eL, p1)

    Va = W["FMA3736"]
    ca = Va.mean(0)
    ax_a = unit(np.linalg.svd(Va - ca, full_matrices=False)[2][0])
    if (ca - mv) @ ax_a < 0:
        ax_a = -ax_a
    prj = (Va - ca) @ ax_a
    band = Va[prj < np.percentile(prj, 4)]
    av = band.mean(0)
    r_av = float(np.sqrt(((band - av) ** 2).sum(1).mean() / 2))

    # ---- structure table --------------------------------------------------
    def keep_thorax(P):
        return in_torso(P, WALL * 0.5)

    items = []                                            # (id, label, group, V, F)
    ATLAS = [("myo", "FMA7274", "Myocardium", "wall"),
             ("mv", "FMA7235", "Mitral valve", "valve"),
             ("tv", "FMA7234", "Tricuspid valve", "valve"),
             ("pv", "FMA7246", "Pulmonary valve", "valve"),
             ("aorta_asc", "FMA3736", "Ascending aorta", "vessel"),
             ("arch", "FMA3768", "Aortic arch", "vessel"),
             ("aorta_desc", "FMA3784", "Descending aorta", "vessel"),
             ("svc", "FMA4720", "Superior vena cava", "vessel"),
             ("ivc", "FMA10951", "Inferior vena cava", "vessel"),
             ("cs", "FMA4706", "Coronary sinus", "detail"),
             ("pap_al", "FMA9352nsn", "Anterolateral papillary muscle", "detail"),
             ("pap_pm", "FMA7266", "Posteromedial papillary muscle", "detail"),
             ("pap_rv_a", "FMA7260", "RV anterior papillary muscle", "detail"),
             ("pap_rv_p", "FMA7261", "RV posterior papillary muscle", "detail"),
             ("pap_rv_s", "FMA7262", "RV septal papillary muscle", "detail")]
    for sid, fma, label, group in ATLAS:
        V, F = W[fma], raw[fma][1]
        if sid in ("aorta_desc", "ivc", "arch", "svc"):
            V, F = clip_and_seal(V, F, keep_thorax)
        items.append((sid, label, group, V, F))

    # aortic valve: authored, anchored on the measured root
    V, F = valve_funnel(av, ax_a, r_av)
    items.append(("av", "Aortic valve", "valve", V, F))

    # pulmonary arteries: trim to the hila, split trunk / left / right
    V, F = W["FMA66326"], raw["FMA66326"][1]
    V, F = clip_and_seal(V, F, lambda P: keep_thorax(P) & (np.linalg.norm(P - pvc, axis=1) < 3.0))
    cen = V[F].mean(axis=1)
    dist = np.linalg.norm(cen - pvc, axis=1)
    for sid, label, sel in (("mpa", "Main pulmonary artery", dist < 1.5),
                            ("lpa", "Left pulmonary artery", (dist >= 1.5) & (cen[:, 0] > pvc[0])),
                            ("rpa", "Right pulmonary artery", (dist >= 1.5) & (cen[:, 0] <= pvc[0]))):
        if sel.sum() < 20:
            continue
        Vs, Fs = clip_and_seal(V, F[sel], lambda P: np.ones(len(P), bool))
        items.append((sid, label, "vessel", Vs, Fs))

    # pulmonary veins: four largest components, named by side and level
    V, F = clip_and_seal(W["FMA66643"], raw["FMA66643"][1],
                         lambda P: keep_thorax(P) & (np.linalg.norm(P - mv, axis=1) < 3.6))
    comps = sorted(components(V, F), key=lambda c: -len(c[0]))[:4]
    tagged = []
    for Vc, Fc in comps:
        c = Vc.mean(0)
        tagged.append((c[0] > mv[0], c[1], Vc, Fc))
    for left in (True, False):
        side = sorted([x for x in tagged if x[0] == left], key=lambda x: -x[1])
        for rank, (_l, _y, Vc, Fc) in enumerate(side):
            sid = ("l" if left else "r") + ("u" if rank == 0 else "l") + "pv"
            label = ("Left " if left else "Right ") + ("upper" if rank == 0 else "lower") + " pulmonary vein"
            items.append((sid, label, "vessel", Vc, Fc))

    # ---- chamber label grid ----------------------------------------------
    lo = Vh.min(0) - 6 * H
    dims = tuple((np.ceil((Vh.max(0) + 6 * H - lo) / H).astype(int) + 1).tolist())
    inside, odd = voxel_inside(Vh, Fw, lo, dims)
    free = ~inside
    lab = np.zeros(dims, np.uint8)
    lab[0, :, :] = lab[-1, :, :] = lab[:, 0, :] = lab[:, -1, :] = lab[:, :, 0] = lab[:, :, -1] = CODE["outside"]
    lab[~free] = 0

    def nearest_free(p, r=14):
        idx = np.round((np.asarray(p) - lo) / H).astype(int)
        best = None
        for dx in range(-r, r + 1):
            for dy in range(-r, r + 1):
                for dz in range(-r, r + 1):
                    q = idx + np.array([dx, dy, dz])
                    if np.any(q < 1) or np.any(q >= np.array(dims) - 1):
                        continue
                    if free[tuple(q)]:
                        dd = dx * dx + dy * dy + dz * dz
                        if best is None or dd < best[0]:
                            best = (dd, tuple(q))
        return best[1]

    seeds = {"lv": mv + 0.50 * (apex - mv), "la": mv + 0.70 * eL,
             "rv": tv - 0.70 * eL, "ra": tv + 0.70 * eL}
    for k, p in seeds.items():
        lab[nearest_free(p)] = CODE[k]
    for _ in range(4000):
        ch = 0
        for ax in (0, 1, 2):
            for sh in (1, -1):
                src = np.roll(lab, sh, axis=ax)
                sl = [slice(None)] * 3
                sl[ax] = 0 if sh == 1 else -1
                src[tuple(sl)] = 0
                m = (lab == 0) & free & (src > 0)
                if m.any():
                    lab[m] = src[m]
                    ch += int(m.sum())
        if ch == 0:
            break
    lab[~free] = 0                                        # myocardium stays 0
    small = lab[::2, ::2, ::2].copy()
    vols = {k: float((lab == v).sum() * H ** 3) for k, v in CODE.items()}

    # ---- write ------------------------------------------------------------
    os.makedirs(OUT, exist_ok=True)
    blob, meta = bytearray(), []
    for sid, label, group, V, F in items:
        vo, io = len(blob), None
        blob += np.asarray(V, np.float32).tobytes()
        io = len(blob)
        blob += np.asarray(F, np.uint32).tobytes()
        meta.append({"id": sid, "label": label, "group": group,
                     "vByte": vo, "vCount": int(len(V)),
                     "iByte": io, "iCount": int(len(F))})
    open(os.path.join(OUT, "heart.bin"), "wb").write(bytes(blob))

    hdr = struct.pack("<3f f 3i", *[float(x) for x in lo], H * 2,
                      *[int(x) for x in small.shape])
    open(os.path.join(OUT, "chambers.bin"), "wb").write(hdr + small.tobytes(order="C"))

    json.dump({"units": "cm",
               "frame": {"x": "patient left", "y": "patient superior", "z": "anterior",
                         "origin": "suprasternal notch (skin)"},
               "source": "BodyParts3D, (c) Database Center for Life Science (DBCLS), CC BY-SA 2.1 Japan",
               "structures": meta,
               "chamber_codes": CODE,
               "chamber_volumes_ml": vols,
               "bytes": len(blob)},
              open(os.path.join(OUT, "heart_meta.json"), "w"), indent=1)

    json.dump({"units": "cm",
               "subject": "term newborn, approx 3.4 kg",
               "torso": {"a": A_T, "c": C_T, "zc": ZC_T, "wall": WALL},
               "registration": {"scale_cm_per_mm": float(SCALE),
                                "atlas_long_axis_mm": float(L_m),
                                "translation_cm": [float(x) for x in t],
                                "fit_residuals_cm": [float(x) for x in fit_resid],
                                "rotation": "atlas body axes mapped to patient body axes"},
               "heart": {"apex": apex.tolist(), "base": mv.tolist(),
                         "long_axis": eL.tolist(), "length": float(np.linalg.norm(mv - apex)),
                         "basis": {"eL": eL.tolist(), "p1_left": p1.tolist(), "p2_posterior": p2.tolist()},
                         "valves": {"mv": mv.tolist(), "tv": tv.tolist(),
                                    "av": av.tolist(), "pv": pvc.tolist()},
                         "aortic_root": {"centre": av.tolist(), "axis": ax_a.tolist(), "radius": r_av}},
               "chamber_seeds": {k: v.tolist() for k, v in seeds.items()},
               "watertight_odd_columns": int(odd)},
              open(os.path.join(OUT, "frame.json"), "w"), indent=1)

    print("structures : %d" % len(items))
    print("triangles  : %d" % sum(m["iCount"] for m in meta))
    print("heart.bin  : %.2f MB" % (len(blob) / 1e6))
    print("chambers   : %s grid, %.0f KB" % (small.shape, small.nbytes / 1e3))
    print("odd columns: %d (0 = watertight)" % odd)
    print("fit resid  : %s cm" % np.round(fit_resid, 3))
    print("volumes mL : %s" % {k: round(v, 2) for k, v in vols.items()})
    for m in meta:
        print("   %-11s %-34s %-7s %6d tri" % (m["id"], m["label"], m["group"], m["iCount"]))


if __name__ == "__main__":
    main()
