"""Generate site/data/views.json.

A view is NOT a hardcoded plane.  Each view names the cardiac section it is
trying to obtain and the acoustic window it is obtained from; the probe pose
(contact point, beam direction, index-mark direction) is then COMPUTED from
that anatomy.  This is the whole point of the rebuild: the slice follows the
probe, and the probe pose follows the anatomy.

Plane rules
  long_axis      plane contains the cardiac long-axis line + the contact point
  rotate         plane contains the long-axis line, rotated phi degrees about
                 it from the long-axis section (phi=90 -> four chamber)
  short_axis     plane perpendicular to the long axis through a level point
  points         plane through the contact point and two named anatomy points

Index-mark convention (cardiology): the index mark maps to the RIGHT of the
displayed image.  Clock positions are reported with 12 = cephalad, 3 = patient
left, 9 = patient right, as the SCAN deck states them.
"""
import json, math, os
import numpy as np

# Works whether the checkout keeps the site under site/ (as in the working tree)
# or serves it from the repository root (as GitHub Pages does).
DATA = "site/data" if os.path.isdir("site/data") else "data"

A = json.load(open(os.path.join(DATA, "anatomy.json")))
AP = {k: np.array(v, float) for k, v in A["aim_points"].items()}
LM = {k: np.array(v, float) for k, v in A["landmarks"].items()}
APEX = np.array(A["heart"]["apex"], float)
BASE = np.array(A["heart"]["base"], float)
eL = np.array(A["heart"]["long_axis"], float)
p1 = np.array(A["heart"]["basis"]["p1_left"], float)
p2 = np.array(A["heart"]["basis"]["p2_posterior"], float)
Y = np.array([0.0, 1.0, 0.0])

def _n(v):
    v = np.asarray(v, float)
    return math.sqrt(float(np.dot(v, v)))


def u(v):
    """Unit vector. Uses an explicit square root rather than
    numpy.linalg.norm so the build never touches a LAPACK routine."""
    v = np.asarray(v, float)
    return v / (_n(v) or 1.0)
L = lambda *a: [round(float(x), 4) for x in a]


WN = {k: np.array(v, float) for k, v in A["window_normals"].items()}


def clock_of(window, index):
    """Index-mark direction as a clock position, read the way an operator reads
    it: projected onto the skin tangent plane at that window, with 12 o'clock
    the direction declared for that window (toward the head on the chest wall,
    toward the chin in the suprasternal notch), 3 = patient left,
    9 = patient right."""
    ns = u(WN[window])                        # outward skin normal
    twelve = np.array(A["window_clock_twelve"][window], float)
    ceph = twelve - np.dot(twelve, ns) * ns
    if _n(ceph) < 1e-3:
        alt = np.array([0.0, 0.0, 1.0]) if abs(twelve[2]) < 0.5 else Y
        ceph = alt - np.dot(alt, ns) * ns
    ceph = u(ceph)
    left = u(np.cross(-ns, ceph))             # looking down the beam into the chest
    ang = math.degrees(math.atan2(np.dot(index, left), np.dot(index, ceph))) % 360.0
    hh = int(round(ang / 30.0)) % 12
    return (12 if hh == 0 else hh), round(ang, 1)


def sym_eig3(M):
    """Eigenvalues and eigenvectors of a symmetric 3x3 matrix, by Jacobi
    rotations, returned in ascending eigenvalue order.

    Written out rather than calling numpy.linalg.eigh so the build does not
    depend on a working LAPACK backend: the only decomposition these scripts
    need is this one, on a 3x3, and a plane normal is too load-bearing to
    leave at the mercy of a broken BLAS install.
    """
    A_ = [[float(M[i][j]) for j in range(3)] for i in range(3)]
    V = [[1.0 if i == j else 0.0 for j in range(3)] for i in range(3)]
    for _ in range(64):
        # largest off-diagonal magnitude
        p_, q_, best = 0, 1, 0.0
        for i, j in ((0, 1), (0, 2), (1, 2)):
            if abs(A_[i][j]) > best:
                best, p_, q_ = abs(A_[i][j]), i, j
        if best < 1e-14:
            break
        app, aqq, apq = A_[p_][p_], A_[q_][q_], A_[p_][q_]
        theta = 0.5 * math.atan2(2.0 * apq, aqq - app)
        c, s_ = math.cos(theta), math.sin(theta)
        for k in range(3):
            akp = A_[k][p_]
            akq = A_[k][q_]
            A_[k][p_] = c * akp - s_ * akq
            A_[k][q_] = s_ * akp + c * akq
        for k in range(3):
            apk = A_[p_][k]
            aqk = A_[q_][k]
            A_[p_][k] = c * apk - s_ * aqk
            A_[q_][k] = s_ * apk + c * aqk
        for k in range(3):
            vkp = V[k][p_]
            vkq = V[k][q_]
            V[k][p_] = c * vkp - s_ * vkq
            V[k][q_] = s_ * vkp + c * vkq
    vals = [A_[i][i] for i in range(3)]
    order = sorted(range(3), key=lambda i: vals[i])
    return ([vals[i] for i in order],
            [[V[r][i] for i in order] for r in range(3)])


def smallest_evec2(M):
    """Unit eigenvector of the smaller eigenvalue of a symmetric 2x2.

    Used for the constrained vessel fit, where the plane is already pinned to
    contain the vessel axis and only the remaining two degrees of freedom are
    solved.  Padding the 2x2 up to a 3x3 would be wrong: the padding row
    contributes a zero eigenvalue that can undercut the real minimum.
    """
    a, b, c = float(M[0][0]), float(M[0][1]), float(M[1][1])
    lo = 0.5 * ((a + c) - math.hypot(a - c, 2.0 * b))
    if abs(b) > 1e-15:
        v = [lo - c, b]
    else:
        v = [1.0, 0.0] if a <= c else [0.0, 1.0]
    nrm = math.hypot(v[0], v[1]) or 1.0
    return [v[0] / nrm, v[1] / nrm]


def smallest_evec(M):
    """Unit eigenvector of the smallest eigenvalue - i.e. the best-fit plane
    normal of the point set whose scatter matrix is M."""
    _, V = sym_eig3(M)
    return u([V[0][0], V[1][0], V[2][0]])


def largest_evec(M):
    """Unit eigenvector of the largest eigenvalue - the dominant axis."""
    _, V = sym_eig3(M)
    return u([V[0][2], V[1][2], V[2][2]])


def index_toward(i):
    """Describe the index-mark direction in plain anatomical terms.

    Preferred over a clock position, which needs a 12 o'clock reference on the
    probe face and is genuinely ambiguous at the suprasternal notch, where the
    face lies almost horizontal.  This description is frame-free: it just names
    the anatomical directions the index mark points along.
    """
    axes = [(float(i[0]), "the patient's left", "the patient's right"),
            (float(i[1]), "the head", "the feet"),
            (float(i[2]), "the chest wall (anterior)", "the back (posterior)")]
    parts = sorted(((abs(c), c, pos, neg) for c, pos, neg in axes), reverse=True)
    out = []
    for mag, c, pos, neg in parts:
        if mag < 0.28:
            continue
        out.append((pos if c > 0 else neg, mag))
        if len(out) == 2:
            break
    if not out:
        return "no dominant direction"
    if len(out) == 1 or out[1][1] < 0.45 * out[0][1]:
        return f"toward {out[0][0]}"
    return f"toward {out[0][0]}, and somewhat toward {out[1][0]}"


def target_normal(rule):
    """Normal of the cardiac section this view is aiming for."""
    if rule["kind"] == "aim_short":
        return u(eL)
    phi = math.radians(rule["phi"])          # 0 = PLAX, 90 = four chamber
    return u(math.cos(phi) * p1 + math.sin(phi) * p2)


def plane_from_rule(rule, contact):
    """Return the unit normal of the imaging plane."""
    kind = rule["kind"]
    if kind in ("aim_long", "aim_short"):
        # How an operator actually acquires a cardiac view: put the beam on the
        # target structure, then rotate the transducer about the beam until the
        # plane is as close as it can get to the intended cardiac section.  The
        # plane therefore always contains the contact point AND the aim point -
        # unlike an ideal section translated onto the window, which slides off
        # the base and loses the valves and atria.
        b = u(AP[rule["aim"]] - contact)
        t = target_normal(rule)
        return u(t - np.dot(t, b) * b)
    if kind == "long_axis":
        # plane contains the long-axis line (through APEX, dir eL) and contact
        return u(np.cross(eL, contact - APEX))
    if kind == "rotate":
        phi = math.radians(rule["phi"])
        # rotate the long-axis section normal (p1) about eL by phi
        return u(math.cos(phi) * p1 + math.sin(phi) * np.cross(eL, p1))
    if kind == "short_axis":
        return u(eL)
    if kind == "points":
        a, b = AP[rule["a"]], AP[rule["b"]]
        return u(np.cross(a - contact, b - contact))
    if kind == "best_fit":
        # Plane through the contact point that best contains the named vessel
        # centreline(s).  A great vessel is a 3-D curve, so no plane contains it
        # exactly; this is the plane an operator converges on.
        #
        # The arithmetic below is written out over plain lists rather than with
        # numpy matrix products: the point sets are a handful of points, and
        # keeping it out of BLAS/LAPACK means the geometry that defines every
        # vessel view cannot be silently changed by a broken numeric backend.
        pts = []
        for vid, (a, b) in rule["axes"]:
            for q in CENTRELINES[vid][a:b]:
                pts.append([float(q[k] - contact[k]) for k in range(3)])

        def scatter(rows, cols=3):
            return [[sum(r[i] * r[j] for r in rows) for j in range(cols)]
                    for i in range(cols)]

        if rule.get("contain_axis", True):
            # Constrain the plane to contain the vessel's own dominant axis,
            # then minimise residuals within that pencil of planes.  Without
            # this constraint an unconstrained least-squares fit can return a
            # transverse plane that cuts the vessel across instead of along it.
            m = [sum(r[k] for r in pts) / len(pts) for k in range(3)]
            cen = [[r[k] - m[k] for k in range(3)] for r in pts]
            d = largest_evec(scatter(cen))
            seed = [1.0, 0.0, 0.0] if abs(d[0]) < 0.9 else [0.0, 1.0, 0.0]
            b1 = u(np.cross(d, seed))
            b2 = u(np.cross(d, b1))
            # coordinates of each point in the 2-D subspace perpendicular to d
            proj = [[sum(r[k] * b1[k] for k in range(3)),
                     sum(r[k] * b2[k] for k in range(3))] for r in pts]
            c2 = smallest_evec2(scatter(proj, 2))
            return u([c2[0] * b1[k] + c2[1] * b2[k] for k in range(3)])
        return smallest_evec(scatter(pts))
    raise ValueError(kind)


CENTRELINES = {s["id"]: np.array(s["path"], float)
               for s in A["structures"] if s["kind"] == "tube"}


def pose(v):
    """Compute the probe pose that realises this view.

    For a canonical cardiac section the plane is fixed by the heart itself: the
    long-axis sections all contain the apex-base line, and the short-axis
    sections are all perpendicular to it.  The probe therefore cannot be placed
    wherever we like - it has to sit where that plane emerges through the chest
    wall.  So for those views we take the ideal plane and slide the nominal
    surface landmark onto it, reporting how far it had to move: that shift is
    the clinical difficulty of the view (finding the true apex, choosing the
    right interspace), not an error to be hidden.

    Vessel views work the other way round - the plane is fitted to the vessel
    and is required to pass through the window.
    """
    contact = LM[v["window"]].copy()
    kind = v["plane"]["kind"]
    shift = 0.0

    if kind == "aim_long":
        # plane contains the cardiac long-axis line, rotated phi from PLAX
        n = target_normal(v["plane"])
        off = float(np.dot(contact - APEX, n))
        contact = contact - off * n
        shift = abs(off)
    elif kind == "aim_short":
        # plane perpendicular to the long axis at the chosen level
        n = u(eL)
        Q = AP[v["plane"]["aim"]]
        off = float(np.dot(contact - Q, n))
        contact = contact - off * n
        shift = abs(off)
    else:
        n = plane_from_rule(v["plane"], contact)

    aim = AP[v["aim"]]
    b = aim - contact
    b = u(b - np.dot(b, n) * n)
    i = u(np.cross(n, b))
    ref = {"patient_left": np.array([1.0, 0, 0]),
           "patient_right": np.array([-1.0, 0, 0]),
           "cephalad": Y, "caudad": -Y,
           "base": BASE - APEX, "apex": APEX - BASE,
           "anterior": np.array([0.0, 0, 1]),
           "posterior": np.array([0.0, 0, -1])}[v["image_right"]]
    if np.dot(i, ref) < 0:
        i = -i
    n = u(np.cross(b, i))
    hh, ang = clock_of(v["window"], i)

    m = {"window_shift_mm": round(10.0 * shift, 1)}
    fam = v["family"]
    m["aim_offset_mm"] = round(10.0 * abs(float(np.dot(aim - contact, n))), 2)
    if fam in ("long_axis", "oblique"):
        m["long_axis_offset_mm"] = round(10.0 * max(
            abs(float(np.dot(APEX - contact, n))),
            abs(float(np.dot(BASE - contact, n)))), 1)
    if fam == "long_axis":
        m["phi_from_plax_deg"] = round(math.degrees(math.atan2(
            float(np.dot(n, np.cross(eL, p1))), float(np.dot(n, p1)))) % 180.0, 1)
    if fam == "short_axis":
        m["level_from_apex_mm"] = round(
            10.0 * float(np.dot(AP[v["aim"]] - APEX, eL)), 1)
    ang_to = lambda nn: round(math.degrees(math.acos(
        min(1.0, abs(float(np.dot(n, u(np.array(nn, float)))))))), 1)
    if v["strict_section"]:
        m["section_deviation_deg"] = ang_to(A["sections"][v["section"]]["normal"])
    else:
        near = min(A["sections"], key=lambda k: ang_to(A["sections"][k]["normal"]))
        m["nearest_section"] = near
        m["nearest_section_deg"] = ang_to(A["sections"][near]["normal"])
    if v.get("vessel_axis"):
        worst = 0.0
        for vid, span in v["vessel_axis"]:
            for q in CENTRELINES[vid][span[0]:span[1]]:
                worst = max(worst, abs(float(np.dot(q - contact, n))))
        m["vessel_axis_offset_mm"] = round(10.0 * worst, 1)
    return contact, b, i, n, hh, ang, m


# --------------------------------------------------------------------- views
V = [
 # ---------------------------------------------------------- PARASTERNAL ---
 dict(id="plax", name="Parasternal long axis (PLAX)", window="ps3",
      section="long_axis", plane=dict(kind="aim_long", phi=0, aim="base"), aim="base",
      image_right="base", depth=4.5, sector=70,
      expect=["lv", "la", "mv", "av", "aorta", "rv", "ivs"],
      absent=["tv", "ra"],
      manoeuvre="Left 3rd intercostal space, immediately lateral to the sternum. "
                "Index mark to the patient's right shoulder. The plane is the heart's "
                "own long axis, so the beam runs from the RV anteriorly, through the "
                "septum and LV cavity, to the LA and aortic root posteriorly.",
      pitfall="Sliding too lateral foreshortens the LV and drops the aortic root out "
              "of plane. If you see the tricuspid valve you have rotated toward the "
              "RV inflow, not the LV long axis.",
      teaches=["LA:Ao ratio", "LV dimensions for fractional shortening"]),

 dict(id="plax_rv_in", name="PLAX - RV inflow (RV inlet sweep)", window="ps3",
      section="long_axis", plane=dict(kind="points", a="tv", b="ra"),
      aim="tv", image_right="base", depth=4.5, sector=70,
      expect=["rv", "ra", "tv"], absent=["lv", "mv"],
      limitation="This is a sweep, not a discrete view, so what is on screen "
                 "depends on where in the sweep you stop. The plane that opens "
                 "the tricuspid valve and RA also clips the aortic root and the "
                 "edge of the left atrium, which is why only the LV and mitral "
                 "valve are listed as reliably absent: those are the structures "
                 "whose disappearance tells you the sweep has left the LV long "
                 "axis and reached the RV inlet.",
      manoeuvre="From PLAX, tilt the beam inferiorly and medially (toward the "
                "patient's right hip) without rotating. The LV drops away and the "
                "tricuspid valve, RA and RV inlet come into plane.",
      pitfall="This is a tilt, not a rotation. Rotating instead gives a short axis.",
      teaches=["Tricuspid regurgitation jet for RV pressure"]),

 dict(id="plax_rv_out", name="PLAX - RV outflow sweep", window="ps2",
      section="long_axis", plane=dict(kind="points", a="pv", b="mpa_bif"),
      aim="pv", image_right="base", depth=3.6, sector=70,
      expect=["rv", "pv", "mpa"], absent=["tv"],
      limitation="Also a sweep. Tilting anteriorly off PLAX brings the RV "
                 "outflow and pulmonary artery in, but at 3.6 cm depth the cut "
                 "still crosses the base, so the left atrium and mitral valve "
                 "can appear at the far field. The tricuspid valve is the "
                 "discriminator that matters: inflow shows it, outflow does not.",
      manoeuvre="From PLAX, tilt the beam superiorly and slightly laterally (toward "
                "the patient's left shoulder) to line up the RV outflow tract, "
                "pulmonary valve and main pulmonary artery.",
      pitfall="Too steep a tilt and the MPA is cut obliquely, overestimating its size.",
      teaches=["Pulmonary valve Doppler", "RVO measurement"]),

 dict(id="psax_av", name="Parasternal short axis - aortic valve level", window="ps3",
      section="short_axis", plane=dict(kind="aim_short", aim="psax_av"), aim="psax_av",
      image_right="patient_left", depth=4.0, sector=70,
      expect=["av", "ra", "la", "ias", "rvot", "aorta"], absent=["mv"],
      limitation="In a real basal cut the tricuspid and pulmonary valves "
                 "flank the aorta, because the operator tilts slightly off a "
                 "pure short axis to catch them. This model renders the exact "
                 "short-axis plane at the aortic valve level, which passes "
                 "above the tricuspid funnel, so the tricuspid valve is not "
                 "drawn here. Use the four-chamber or RV-inflow view for it.",
      manoeuvre="From PLAX, rotate the probe 90 degrees clockwise so the index mark "
                "points to the patient's left shoulder. The aortic valve appears "
                "centrally as the tri-leaflet 'Mercedes' sign.",
      pitfall="The circle of the aorta must be round. If it is oval you are still "
              "cutting obliquely - rotate a few more degrees.",
      teaches=["Tri-leaflet aortic valve", "Interatrial septum and shunt direction"]),

 dict(id="psax_mv", name="Parasternal short axis - mitral valve level", window="ps3",
      section="short_axis", plane=dict(kind="aim_short", aim="psax_mv"), aim="psax_mv",
      image_right="patient_left", depth=4.0, sector=70,
      expect=["mv", "lv", "rv"], absent=["av"],
      manoeuvre="Hold the short-axis rotation and tilt the beam toward the apex "
                "(inferolaterally) until the mitral leaflets open as a 'fish mouth'.",
      pitfall="Tilting rather than sliding keeps the same window; sliding laterally "
              "loses the parasternal window altogether.",
      teaches=["Mitral leaflet motion"]),

 dict(id="psax_pap", name="Parasternal short axis - mid-papillary", window="ps4",
      section="short_axis", plane=dict(kind="aim_short", aim="psax_pap"), aim="psax_pap",
      image_right="patient_left", depth=4.0, sector=70,
      expect=["lv", "rv", "ivs", "pap_al", "pap_pm"], absent=["mv", "av", "la"],
      manoeuvre="Continue tilting toward the apex until both papillary muscles are "
                "seen inside a circular LV cavity.",
      pitfall="This is the level for eyeballing regional wall motion and the "
              "'kissing ventricles' of a severely underfilled heart.",
      teaches=["Visual LV function", "Kissing ventricles in hypovolaemia",
               "Septal flattening in pulmonary hypertension"]),

 dict(id="psax_apical", name="Parasternal short axis - apical level", window="ps4",
      section="short_axis", plane=dict(kind="aim_short", aim="psax_apical"), aim="psax_apical",
      image_right="patient_left", depth=3.5, sector=70,
      expect=["lv", "rv"], absent=["mv", "av", "la", "ra"],
      manoeuvre="The most apical short-axis cut; the LV cavity is small and the RV "
                "has almost disappeared.",
      pitfall="Easy to mistake a foreshortened oblique cut for a true apical level.",
      teaches=["Apical wall motion"]),

 dict(id="psax_pda", name="Parasternal short axis - ductal cut (PDA)", window="high_ps",
      section="vessel_short_axis",
      plane=dict(kind="best_fit", contain_axis=False,
                 axes=[("pda", (0, 3)), ("mpa", (1, 3)), ("lpa", (0, 2))]),
      aim="duct", image_right="cephalad", depth=4.0, sector=70,
      expect=["mpa", "lpa", "pda", "aorta", "rpa"], absent=["lv", "mv"],
      manoeuvre="From the aortic-valve short axis, slide one interspace higher and "
                "angle the beam toward the patient's left shoulder. The MPA, its "
                "bifurcation and the duct entering the descending aorta line up as "
                "the 'three-legged' ductal view.",
      pitfall="The duct is often mistaken for the LPA. Follow the MPA to its "
              "bifurcation first, then look posteriorly for the third limb.",
      teaches=["Duct patency and size at the pulmonary end",
               "Shunt direction and peak velocity"]),

 # --------------------------------------------------------------- APICAL ---
 dict(id="a4c", name="Apical four chamber", window="apical",
      section="four_chamber", plane=dict(kind="aim_long", phi=90, aim="base"), aim="base",
      image_right="patient_left", depth=5.0, sector=75,
      expect=["lv", "rv", "la", "ra", "mv", "tv", "ivs", "ias"],
      absent=["av", "pv", "mpa"],
      manoeuvre="Probe over the apex beat, left 4th-5th interspace, index mark to "
                "the patient's left (3 o'clock). The beam runs from apex to base "
                "along the long axis, and the plane contains both AV valves.",
      pitfall="The commonest error is foreshortening: sliding medially puts the "
              "beam off the true apex and shortens the LV. The LV should be the "
              "longest chamber and its apex should sit at the top of the sector.",
      teaches=["Chamber size and symmetry", "Transmitral E/A ratio",
               "TAPSE", "Visual biventricular function"]),

 dict(id="a5c", name="Apical five chamber", window="apical",
      section="four_chamber", plane=dict(kind="points", a="apex", b="av"), aim="av",
      image_right="patient_left", depth=5.0, sector=75,
      expect=["lv", "rv", "la", "ra", "av", "aorta", "lvot"], absent=["tv", "pda"],
      limitation="The five-chamber plane cannot both contain the heart's long "
                 "axis and pass through the aortic valve - the valve sits about "
                 "23 degrees off the long-axis plane. So this view is a genuine "
                 "anterior TILT rather than a rotation, and it buys the aorta at "
                 "the cost of the tricuspid valve, which drops out of plane. The "
                 "RV outflow tract appears at the anterior edge.",
      manoeuvre="From the four chamber, tilt the beam anteriorly (toward the chest "
                "wall). The aortic valve and LVOT appear in the centre of the "
                "sector, making the 'fifth chamber'.",
      pitfall="Tilt, do not rotate. Over-tilting loses the atria.",
      teaches=["LVOT Doppler for left ventricular output"]),

 dict(id="a3c", name="Apical three chamber (apical long axis)", window="apical",
      section="long_axis", plane=dict(kind="aim_long", phi=0, aim="base"), aim="base",
      image_right="base", depth=5.0, sector=75,
      expect=["lv", "la", "mv", "av", "aorta"], absent=["tv", "ra"],
      manoeuvre="From the four chamber, rotate the probe counter-clockwise about "
                "the beam until the aortic root appears alongside the mitral valve. "
                "This is the same cardiac long-axis section as PLAX, seen from the "
                "apex instead of the parasternum.",
      pitfall="This view aligns the beam with LVOT flow, so it is the view of "
              "choice for left ventricular output; a poorly aligned beam "
              "underestimates the velocity time integral.",
      teaches=["Left ventricular output (VTI x CSA x HR)"]),

 dict(id="a2c", name="Apical two chamber", window="apical",
      section="long_axis", plane=dict(kind="aim_long", phi=135, aim="base"), aim="base",
      image_right="base", depth=5.0, sector=75,
      expect=["lv", "la", "mv"], absent=["ra", "tv"],
      manoeuvre="Continue rotating from the three chamber until only the LV and LA "
                "remain, with the anterior and inferior LV walls facing each other.",
      pitfall="Rotation must be about the beam axis; drifting off the apex "
              "foreshortens the ventricle.",
      teaches=["Anterior and inferior LV wall motion"]),

 # ------------------------------------------------------------ SUBCOSTAL ---
 dict(id="sub_long", name="Subcostal long axis (four-chamber equivalent)",
      window="subcostal", section="four_chamber",
      plane=dict(kind="aim_long", phi=90, aim="base"), aim="base",
      image_right="patient_left", depth=6.0, sector=80,
      expect=["lv", "rv", "la", "ra", "mv", "tv", "liver"], absent=["pv"],
      manoeuvre="Probe flat in the subxiphoid hollow, angled steeply cephalad so "
                "the beam passes up through the liver into the heart. Gives a "
                "four-chamber-equivalent plane from below.",
      pitfall="The liver is the acoustic window, so keep the beam angled, not "
              "pressed. This window survives when the parasternal window is lost "
              "to lung, and is the workhorse when the chest is not accessible.",
      teaches=["Chamber size when the precordium is unavailable",
               "Atrial septal anatomy"]),

 dict(id="sub_lvot", name="Subcostal long axis - aorta / LV outflow",
      window="subcostal", section="long_axis",
      plane=dict(kind="aim_long", phi=0, aim="base"),
      aim="base", image_right="base", depth=6.0, sector=80,
      expect=["lv", "av", "aorta", "la"], absent=["tv", "ra"],
      manoeuvre="From the subcostal long axis, rotate and tilt slightly rightward "
                "to open the LV outflow tract and ascending aorta.",
      pitfall="Beam-flow alignment is usually better here than parasternal for "
              "outflow Doppler in a small infant.",
      teaches=["LVOT alignment", "Aortic arch continuity"]),

 dict(id="sub_rvot", name="Subcostal long axis - pulmonary artery / RV outflow",
      window="subcostal", section="long_axis",
      plane=dict(kind="points", a="pv", b="mpa_bif"), aim="pv",
      image_right="base", depth=6.0, sector=80,
      expect=["rv", "pv", "mpa", "liver"], absent=["la", "mv"],
      manoeuvre="Tilt further anteriorly and to the patient's left to bring the RV "
                "outflow tract and main pulmonary artery into the plane.",
      pitfall="The MPA runs away from the subcostal beam, so it is easy to cut it "
              "obliquely and overcall its size.",
      teaches=["RV outflow and pulmonary valve Doppler"]),

 dict(id="sub_ivc", name="Subcostal short axis - IVC (sagittal)", window="subcostal",
      section="vessel_long_axis",
      plane=dict(kind="best_fit", axes=[("ivc", (0, 3))]),
      aim="ivc_mid", image_right="cephalad", depth=5.0, sector=70,
      clock_stated="12 o\'clock",
      source="SCAN deck slide 22, which labels this view and states 'Pointer 12 o\'clock'.",
      expect=["ivc", "ra", "hepatic_v", "liver"], absent=["lv", "mv"],
      manoeuvre="Rotate to a sagittal plane just right of the midline and follow "
                "the IVC through the liver to its entry into the right atrium. "
                "The hepatic vein joins it just below the diaphragm.",
      pitfall="Measure the IVC where it is straight and at a fixed point through "
              "the respiratory cycle; oblique cuts exaggerate the diameter.",
      teaches=["IVC diameter as a volume-status marker",
               "IVC distensibility index (max-min)/min, normal ~18%",
               "Collapsibility >50% suggests a low central venous pressure"]),

 dict(id="sub_aorta", name="Subcostal short axis - abdominal aorta (sagittal)",
      window="subcostal", section="vessel_long_axis",
      plane=dict(kind="best_fit", axes=[("aorta", (5, 8)), ("celiac", (0, 2))]),
      aim="abdo_ao", image_right="cephalad", depth=5.0, sector=70,
      expect=["aorta", "celiac", "sma", "liver"], absent=["lv", "la", "mv"],
      manoeuvre="From the IVC plane, slide slightly to the patient's left and "
                "angle posteriorly; the abdominal aorta is the pulsatile vessel "
                "with the coeliac trunk and SMA arising anteriorly.",
      pitfall="The aorta lies to the patient's left of, and deeper than, the IVC. "
              "Confusing the two inverts the whole assessment.",
      teaches=["Descending aorta peak systolic and diastolic velocity",
               "Coeliac / SMA flow as markers of systemic hypoperfusion",
               "Diastolic flow reversal with a large duct"]),

 # --------------------------------------------- SUPRASTERNAL / HIGH PARA ---
 dict(id="ssn_arch", name="Suprasternal long axis - aortic arch", window="supra",
      section="vessel_long_axis",
      plane=dict(kind="best_fit", axes=[("aorta", (1, 6))]),
      aim="arch", image_right="cephalad", depth=4.5, sector=70,
      clock_stated="12-1 o\'clock",
      index_note="The deck gives the pointer as 12-1 o'clock but says nothing "
                 "about caudad or cephalad. Read against the body, 12 o'clock "
                 "is toward the head, so the index axis here is oriented "
                 "cephalad. That is an interpretation of the deck's clock "
                 "figure, not a separate statement in it.",
      source="SCAN deck slide 29, Longitudinal Aortic Arch View, which states the pointer at 12-1 o\'clock.",
      expect=["aorta", "innominate", "lcca", "lsca", "rpa"],
      absent=["lv", "mv", "tv"],
      manoeuvre="Probe in the suprasternal notch with the neck extended. The plane "
                "of the arch is tilted and rotated off a true sagittal cut, so "
                "start sagittal and rotate until the whole 'candy cane' opens up. "
                "The right pulmonary artery is cut in cross-section under the arch.",
      pitfall="Extending the neck and turning the head slightly away opens the "
              "notch. If only part of the arch is seen, rotate rather than slide.",
      teaches=["Arch anatomy and the three head/neck vessels",
               "Coarctation and diastolic run-off",
               "Duct seen distal to the left subclavian"]),

 dict(id="ssn_crab", name="Suprasternal short axis - 'crab' / pulmonary veins",
      window="supra", section="short_axis",
      plane=dict(kind="points", a="pulm_veins", b="la_left"),
      aim="pulm_veins", image_right="patient_right", depth=4.5, sector=75,
      clock_stated="9 o\'clock",
      source="Recorded SCAN lecture slide 'Supra-sternal PV view (crab view) - upper 1/3rd sternum, pointer 9 o\'clock'. The slide deck does not cover this view.",
      expect=["la", "lupv", "rupv"],
      absent=["mv", "av"],
      manoeuvre="Upper third of the sternum, index mark toward the patient's right. The "
                "coronal plane opens the left atrium with all four pulmonary veins "
                "entering it - the 'crab' - alongside the SVC.",
      pitfall="A shallow coronal plane shows the arch in cross-section instead; "
              "angle slightly more posteriorly to drop onto the atrium. Counting "
              "all four veins needs a slow sweep through the atrium rather than "
              "one frozen plane - the upper pair and the lower pair do not lie in "
              "the same cut.",
      teaches=["Confirming all four pulmonary veins",
               "Excluding anomalous pulmonary venous drainage"]),

 dict(id="high_ps_duct", name="High parasternal ductal view", window="high_ps",
      section="vessel_long_axis",
      plane=dict(kind="best_fit", axes=[("pda", (0, 3)), ("aorta", (4, 6))]),
      aim="duct", image_right="caudad", depth=4.0, sector=70,
      expect=["pda", "aorta", "mpa", "lpa"], absent=["lv", "mv", "tv"],
      manoeuvre="High left parasternal, beam angled toward the left shoulder. The "
                "duct is displayed along its length between the descending aorta "
                "and the pulmonary artery, which is the plane for aligning Doppler "
                "with ductal flow.",
      pitfall="This is the view for ductal velocity and flow direction; the short "
              "axis ductal cut is better for measuring ductal diameter.",
      teaches=["Ductal flow direction: left-to-right, bidirectional, right-to-left",
               "Peak and end-diastolic ductal velocity"]),

 dict(id="svc_flow", name="SVC long axis (SVC flow)", window="supra",
      section="vessel_long_axis",
      plane=dict(kind="best_fit", axes=[("svc", (0, 4))]),
      index_note="No source states a pointer position for this view. The index "
                 "axis is oriented cephalad to match the suprasternal arch "
                 "view, so that both sagittal views from the notch share one "
                 "display convention and the SVC does not appear mirrored "
                 "relative to the arch beside it. This is a house convention.",
      aim="svc_mid", image_right="cephalad", depth=4.5, sector=70,
      expect=["svc", "ra"], absent=["lv", "mv"],
      manoeuvre="From the suprasternal notch angle slightly to the patient's right "
                "and rotate to a sagittal plane to lay the SVC out along its length "
                "as it descends into the right atrium.",
      pitfall="SVC flow is highly angle-dependent; keep the beam within 20 degrees "
              "of the vessel axis.",
      teaches=["SVC flow as a surrogate for upper body / cerebral perfusion"]),
]

# --------------------------------------------------------------- taxonomy
# family: long_axis = the plane contains the heart's long axis (the family the
#         SCAN deck calls "longitudinal", parametrised by rotation phi);
#         short_axis = perpendicular to the long axis;
#         vessel = the plane follows a great vessel rather than a cardiac axis.
# strict = assert the plane really is the named canonical section (0 deg).
# vessel_axis = (structure id, centreline index span) that must lie in-plane.
TAX = {
 "plax":        ("long_axis",  True,  []),
 "plax_rv_in":  ("oblique",    False, []),
 "plax_rv_out": ("oblique",    False, [("mpa", (0, 3))]),
 "psax_av":     ("short_axis", True,  []),
 "psax_mv":     ("short_axis", True,  []),
 "psax_pap":    ("short_axis", True,  []),
 "psax_apical": ("short_axis", True,  []),
 "psax_pda":    ("vessel",     False, [("pda", (0, 3))]),
 "a4c":         ("long_axis",  True,  []),
 "a5c":         ("oblique",    False, []),
 "a3c":         ("long_axis",  True,  []),
 "a2c":         ("long_axis",  False, []),
 "sub_long":    ("long_axis",  False, []),
 "sub_lvot":    ("long_axis",  True,  []),
 "sub_rvot":    ("oblique",    False, [("mpa", (0, 3))]),
 "sub_ivc":     ("vessel",     False, [("ivc", (0, 3))]),
 "sub_aorta":   ("vessel",     False, [("aorta", (5, 8))]),
 "ssn_arch":    ("vessel",     False, [("aorta", (1, 6))]),
 "ssn_crab":    ("vessel",     False, []),
 "high_ps_duct": ("vessel",    False, [("pda", (0, 3))]),
 "svc_flow":    ("vessel",     False, [("svc", (0, 3))]),
}
# Views that are deliberately off-axis get an honest section label rather than
# being described as a canonical cardiac section they are not.
SECTION_OVERRIDE = {
    "plax_rv_in": "oblique_long_axis", "plax_rv_out": "oblique_long_axis",
     "sub_rvot": "oblique_long_axis",
    "a2c": "long_axis_family", "ssn_crab": "vessel_coronal",
}
for v in V:
    fam, strict, vax = TAX[v["id"]]
    v["family"], v["strict_section"], v["vessel_axis"] = fam, strict, vax
    v["section"] = SECTION_OVERRIDE.get(v["id"], v["section"])

OUT = []
for v in V:
    contact, b, i, n, hh, ang, metrics = pose(v)
    OUT.append({
        "id": v["id"], "name": v["name"], "window": v["window"],
        "window_label": A["window_labels"][v["window"]],
        "family": v["family"], "section": v["section"],
        "strict_section": v["strict_section"],
        "plane_rule": v["plane"], "aim": v["aim"],
        "contact": L(*contact),
        "window_nominal": L(*LM[v["window"]]), "beam": L(*b), "index": L(*i), "normal": L(*n),
        "index_toward": index_toward(i),
        "clock_computed": hh, "clock_deg": ang,
        "clock_stated": v.get("clock_stated"),
        "depth": v["depth"], "sector": v["sector"],
        "image_right": v["image_right"], "metrics": metrics,
        "expect": v["expect"], "absent": v["absent"],
        "vessel_axis": v["vessel_axis"],
        "manoeuvre": v["manoeuvre"], "pitfall": v["pitfall"],
        "limitation": v.get("limitation"),
        "index_note": v.get("index_note"),
        "source": v.get("source"),
        "teaches": v["teaches"],
    })

json.dump({"convention": {
    "index_mark": "index mark maps to the RIGHT of the displayed image "
                  "(cardiology convention)",
    "clock": "12 o'clock = cephalad, 3 = patient left, 9 = patient right",
    "image_vertical": "transducer face at the top of the sector; depth increases "
                      "downward along the beam"},
    "windows": A["landmarks"], "views": OUT},
    open(os.path.join(DATA, "views.json"), "w"), indent=1)

hdr = (f"{'id':14} {'window':10} {'family':11} {'section':18} {'clk':>5} "
       f"{'phi':>6} {'dSec':>6} {'LAoff':>6} {'lvl':>5} {'Vax':>5}  near")
print(hdr); print("-" * len(hdr))
for o in OUT:
    m = o["metrics"]
    near = (f"{m['nearest_section']} {m['nearest_section_deg']}d"
            if "nearest_section" in m else "")
    print(f"{o['id']:14} {o['window']:10} {o['family']:11} {o['section']:18} "
          f"{(o['clock_stated'] or str(o['clock_computed'])+'h'):>5} "
          f"{m.get('phi_from_plax_deg', ''):>6} "
          f"{m.get('section_deviation_deg', ''):>6} "
          f"{m.get('long_axis_offset_mm', ''):>6} "
          f"{m.get('level_from_apex_mm', ''):>5} "
          f"{m.get('vessel_axis_offset_mm', ''):>5}  {near}")
print("\nphi   = rotation of the plane about the cardiac long axis, from PLAX "
      "(0 = PLAX, 90 = four chamber)")
print("dSec  = angle to the named canonical section (asserted views only)")
print("LAoff = worst distance of the apex-base line from the plane (mm)")
print("lvl   = short-axis cut level along the long axis, from the apex (mm)")
print("Vax   = worst distance of the named vessel centreline from the plane (mm)")
