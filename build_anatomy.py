"""Generate data/anatomy.json + data/views.json for the neonatal echo trainer.

Patient (world) frame, right-handed, units = cm:
    +X = patient LEFT      +Y = patient SUPERIOR (cephalad)     +Z = ANTERIOR
Origin = suprasternal notch (SSN) at the skin.

Dimensions are those of a term newborn (~3.4 kg): heart long axis ~3.4 cm,
LV cavity length ~3.0 cm, chest AP depth ~7.6 cm, sternum ~4.8 cm.

Every cardiac structure is declared analytically (ellipsoid shell or swept
tube).  The browser tessellates these primitives for rendering and slicing;
verify_planes.py intersects the same primitives exactly.  One source of truth.
"""
import json, math, os
import numpy as np

# Works whether the checkout keeps the site under site/ (as in the working tree)
# or serves it from the repository root (as GitHub Pages does).
DATA = "site/data" if os.path.isdir("site/data") else "data"


def u(v):
    """Unit vector, with an explicit square root rather than
    numpy.linalg.norm, so the build never touches a LAPACK routine."""
    v = np.asarray(v, float)
    n = math.sqrt(float(np.dot(v, v)))
    return v / (n or 1.0)

def perp(ref, axis):
    """Component of `ref` perpendicular to `axis`, normalised."""
    ref, axis = np.asarray(ref, float), u(axis)
    return u(ref - np.dot(ref, axis) * axis)

L = lambda *a: [round(float(x), 4) for x in a]

# ----------------------------------------------------------------- landmarks
# Surface (skin) landmarks and acoustic windows.
LM = {
    "ssn":            [0.00,  0.00,  0.00],   # suprasternal notch
    "sternal_angle":  [0.00, -0.90,  0.55],
    "mid_sternum":    [0.00, -2.40,  0.75],
    "xiphisternum":   [0.00, -4.70,  0.55],
    "ps2":            [1.10, -1.70,  0.85],   # left 2nd ICS parasternal
    "ps3":            [1.25, -2.70,  0.95],   # left 3rd ICS  <- main parasternal
    "ps4":            [1.35, -3.60,  0.90],   # left 4th ICS
    "rps4":           [-1.30, -3.60, 0.85],   # right 4th ICS
    "apical":         [2.75, -4.35,  0.35],   # left 4th-5th ICS, apex beat
    "subcostal":      [0.00, -5.50,  0.15],   # subxiphoid
    "high_ps":        [0.95, -1.15,  0.75],   # high left parasternal (ductal)
    "supra":          [0.00,  0.15, -0.10],   # suprasternal notch contact
}

# ------------------------------------------------------- cardiac axis system
APEX = np.array([2.05, -4.25, -0.45])          # LV apex (endocardial tip)
BASE = np.array([-0.10, -1.85, -1.45])         # centre of the valve plane

eL = u(BASE - APEX)          # long axis, apex -> base
HEART_LEN = math.sqrt(float(np.dot(BASE - APEX, BASE - APEX)))
# p1 = in-valve-plane axis pointing to the patient's left  (MV <- -> TV axis)
p1 = perp([1, 0, 0], eL)
# p2 = eL x p1  -> points posterior/inferior;  -p2 is anterior
p2 = u(np.cross(eL, p1))

def C(base, a=0.0, b=0.0, c=0.0):
    """Point at `base` + a*p1 + b*p2 + c*eL."""
    return np.asarray(base, float) + a * p1 + b * p2 + c * eL

# Valve centres in the base-plane basis (p1 = patient left, -p2 = anterior).
# BASE is the mitral annulus centre by definition, since the LV long axis runs
# from the apex through the centre of the mitral annulus.  MV and TV therefore
# both sit at p2 ~ 0, in the four-chamber plane; AV and PV sit anterior to it.
MV = C(BASE,  0.00,  0.00,  0.00)
TV = C(BASE, -1.35,  0.05,  0.04)
AV = C(BASE, -0.22, -0.52,  0.22)
PV = C(BASE,  0.05, -1.15,  0.45)
AO_DIR = C(BASE, -0.34, -0.60, 1.00) - AV      # ascending aorta direction
PA_DIR = C(BASE,  0.20, -1.45, 1.05) - PV      # main pulmonary artery direction

# ---------------------------------------------------------- cardiac sections
# The three teaching sections are defined against the heart's own axes.
#   long axis  : contains eL, normal = p1      (PLAX family)
#   four chamb.: contains eL, normal = p2      (A4C family; MV-TV axis in plane)
#   short axis : normal = eL                   (PSAX family)
SECTIONS = {
    "long_axis":   {"normal": L(*p1), "contains_long_axis": True,
                    "label": "Long axis",
                    "note": "Along the long axis of the HEART, not the body. "
                            "The green pepper cut lengthwise, stem included."},
    "four_chamber": {"normal": L(*p2), "contains_long_axis": True,
                     "label": "Four chamber",
                     "note": "Contains the long axis and both AV valves; "
                             "90 degrees to the long-axis section."},
    "short_axis":  {"normal": L(*eL), "contains_long_axis": False,
                    "label": "Short axis",
                    "note": "90 degrees to the long axis. The pepper cut "
                            "across into circular slices."},
}

# --------------------------------------------------------------- structures
S = []

def ellipsoid_shell(sid, label, group, centre, ax, radii, wall, tissue="myocardium",
                    clip=None, cavity_scale=None):
    """Chamber = outer ellipsoid with a concentric cavity inset by `wall`."""
    ax = [L(*u(a)) for a in ax]
    inner = [max(0.04, r - wall) for r in radii] if cavity_scale is None \
        else [r * s for r, s in zip(radii, cavity_scale)]
    S.append({"id": sid, "label": label, "group": group, "kind": "shell",
              "tissue": tissue, "axes": ax, "centre": L(*centre),
              "radii": L(*radii), "cavity": L(*inner),
              "clip": clip or []})

def tube(sid, label, group, pts, radius, wall=0.055, tissue="vessel", taper=None):
    S.append({"id": sid, "label": label, "group": group, "kind": "tube",
              "tissue": tissue, "path": [L(*p) for p in pts],
              "radius": round(float(radius), 4), "wall": wall,
              "taper": taper or [1.0] * len(pts)})

def disc(sid, label, group, centre, normal, r, thick=0.045, tissue="valve"):
    S.append({"id": sid, "label": label, "group": group, "kind": "disc",
              "tissue": tissue, "centre": L(*centre), "normal": L(*u(normal)),
              "radius": round(float(r), 4), "thick": thick})

# ---- ventricles ------------------------------------------------------------
# LV: prolate ellipsoid about the long axis, 0.32 cm free wall.  Sized so the
# basal pole lands on the mitral annulus and the apical pole on the apex, so no
# truncation is needed: the solid stays closed and a cut through it always
# yields fillable contour loops.
LV_C = C(APEX, 0.0, 0.0, 1.67)
LV_R = [1.02, 0.98, 1.70]
LV_HOST = {"centre": L(*LV_C), "axes": [L(*p1), L(*p2), L(*eL)],
           "radii": L(*LV_R)}
ellipsoid_shell("lv", "Left ventricle", "chamber", LV_C, [p1, p2, eL],
                LV_R, 0.32)

# Angles below are measured about the long axis from +p1 (the LV lateral wall)
# toward +p2 (posterior):  0 = lateral, 90 = inferior/posterior,
# 180 = septal/right, 270 = anterior.
# The RV drapes over the septal-to-anterior aspect as a true crescent - which
# is why the parasternal short axis shows a D-shaped LV with the RV on one
# side, and why the RV appears anteriorly in PLAX but beside the LV in A4C.
S.append({"id": "rv", "label": "Right ventricle", "group": "chamber",
          "kind": "crescent", "tissue": "myocardium", "host": LV_HOST,
          "span": [168, 322], "sRange": [-0.70, 0.95],
          "gap": 0.0, "depth": 0.55, "wall": 0.16,
          "peak": 0.35, "reach": 1.55})

# The interventricular septum is the part of the LV wall that faces the RV, so
# it is the same crescent band, lying inside the LV outer surface.
S.append({"id": "ivs", "label": "Interventricular septum", "group": "wall",
          "kind": "crescent", "tissue": "myocardium", "host": LV_HOST,
          "span": [168, 322], "sRange": [-0.85, 0.95],
          "gap": -0.32, "depth": 0.0, "wall": 0.32,
          "peak": 0.10, "reach": 1.75})

# Papillary muscles inside the LV cavity, at the mid-papillary level: the
# anterolateral and posteromedial pair seen in that short-axis cut.
for nm, lbl, phi in (("al", "Anterolateral papillary muscle", 315.0),
                     ("pm", "Posteromedial papillary muscle", 100.0)):
    a = math.radians(phi)
    ellipsoid_shell(f"pap_{nm}", lbl, "detail",
                    C(APEX, 0.42 * math.cos(a), 0.42 * math.sin(a), 1.15),
                    [p1, p2, eL], [0.20, 0.20, 0.45], 0.20,
                    tissue="myocardium")

# ---- atria -----------------------------------------------------------------
# Both atria straddle the four-chamber plane (p2 ~ 0) and sit basal to the
# valve plane along the long axis.
LA_C = C(BASE, 0.10, 0.18, 0.78)
ellipsoid_shell("la", "Left atrium", "chamber", LA_C, [p1, p2, eL],
                [0.80, 0.76, 0.72], 0.11)
RA_C = C(BASE, -1.15, 0.20, 0.80)
ellipsoid_shell("ra", "Right atrium", "chamber", RA_C, [p1, p2, eL],
                [0.82, 0.78, 0.76], 0.10)
# Interatrial septum - the structure named on SCAN slide 16.  Thin in p1, so
# the four-chamber plane cuts it but the long-axis plane does not.
ellipsoid_shell("ias", "Interatrial septum", "wall",
                C(BASE, -0.52, 0.19, 0.79), [p1, p2, eL],
                [0.06, 0.72, 0.70], 0.06, tissue="myocardium")

# ---- valves ----------------------------------------------------------------
# The mitral annulus centre IS the basal end of the LV long axis, and the
# tricuspid annulus sits beside it in the same four-chamber plane.  The aortic
# and pulmonary valves lie anterior to that plane, which is exactly why the
# four-chamber view shows neither and the five-chamber view shows the aorta.
# Valves are given real extent along their own axis rather than being infinitely
# thin discs: a disc perpendicular to the long axis would be invisible to every
# short-axis cut except one at exactly its level.  The AV valves are modelled as
# the thin leaflet funnel projecting into the ventricle - thin because a
# leaflet images as a bright line, not a filled blob - which is what
# produces the "fish mouth" appearance in the short-axis mitral cut.
tube("mv", "Mitral valve", "valve",
     [MV + 0.06 * eL, MV - 0.34 * eL, MV - 0.78 * eL], 0.42,
     wall=0.07, tissue="valve", taper=[1.0, 0.86, 0.62])
tube("tv", "Tricuspid valve", "valve",
     [TV + 0.42 * eL, TV - 0.16 * eL, TV - 0.66 * eL], 0.52,
     wall=0.07, tissue="valve", taper=[1.0, 0.85, 0.60])
tube("av", "Aortic valve", "valve",
     [AV - 0.20 * u(AO_DIR), AV, AV + 0.22 * u(AO_DIR)], 0.32,
     wall=0.05, tissue="valve", taper=[0.94, 1.0, 0.96])
tube("pv", "Pulmonary valve", "valve",
     [PV - 0.20 * u(PA_DIR), PV, PV + 0.22 * u(PA_DIR)], 0.34,
     wall=0.05, tissue="valve", taper=[0.94, 1.0, 0.96])

# Outflow tracts, so the five-chamber and RV-outflow views have something to
# show between the ventricle and its valve.
tube("lvot", "LV outflow tract", "flow",
     [C(BASE, 0.02, -0.16, -0.30), C(BASE, -0.12, -0.34, -0.02), AV],
     0.30, wall=0.02, tissue="blood", taper=[0.95, 1.0, 1.02])
tube("rvot", "RV outflow tract", "flow",
     [C(BASE, -0.55, -0.72, -0.35), C(BASE, -0.25, -0.98, 0.05), PV],
     0.32, wall=0.02, tissue="blood", taper=[0.95, 1.02, 1.04])

# ---- great arteries --------------------------------------------------------
# Aorta: valve -> ascending -> arch (rightward, then leftward over the top)
# -> descending, running caudad just left of the spine.
# The ascending aorta lies to the patient's RIGHT of the midline and the
# descending aorta to the LEFT of it, so the arch is a near-planar curve in a
# plane that is tilted and rotated off a true sagittal cut - which is exactly
# how the SCAN deck describes the suprasternal arch view.
# The arch is built INSIDE a single plane that passes through the suprasternal
# notch, rather than authored in world coordinates and then flattened.  A real
# arch is very nearly planar, and making the model exactly so is what lets one
# suprasternal long-axis plane show the whole "candy cane" AND all three
# head/neck vessels at once - the three-vessel sign.
ARCH_SUMMIT = np.array([-0.10, 0.02, -1.78])
_ssn = np.array(LM["supra"], float)
ARCH_N = u(np.cross(ARCH_SUMMIT - _ssn, [0.055, -1.0, -0.20]))
_e1 = perp([0, -1, 0], ARCH_N)                 # caudad, within the arch plane
_e2 = u(np.cross(ARCH_N, _e1))
if _e2[2] < 0:
    _e2 = -_e2                                 # anterior, within the arch plane
ARCH_TILT_DEG = round(math.degrees(math.acos(min(1.0, abs(ARCH_N[0])))), 1)


def _arch_pt(alpha, beta):
    """Point in the arch plane: alpha caudad of the summit, beta anterior."""
    return ARCH_SUMMIT + alpha * _e1 + beta * _e2


ao_path = [AV,
           _arch_pt(1.45,  0.55),   # ascending aorta
           _arch_pt(0.55,  0.42),   # proximal arch
           _arch_pt(0.00,  0.00),   # arch summit, behind the notch
           _arch_pt(0.50, -0.42),   # distal arch
           _arch_pt(1.15, -0.55),   # isthmus, just distal to the LSCA
           # below the isthmus the aorta leaves the arch plane and runs
           # caudad just to the patient's left of the vertebral column
           np.array([0.24, -2.75, -2.42]),   # descending thoracic
           np.array([0.21, -4.60, -2.45]),
           np.array([0.19, -6.40, -2.42])]   # abdominal aorta
AO_ISTHMUS = ao_path[5]               # index 5 = isthmus, just distal to the LSCA
tube("aorta", "Aorta", "vessel", ao_path, 0.34,
     taper=[1.0, 1.06, 1.08, 1.04, 0.96, 0.90, 0.82, 0.76, 0.70])

# Head and neck vessels, in proximal-to-distal order: brachiocephalic, left
# carotid, left subclavian.  Their origins are taken ON the arch centreline so
# that the suprasternal arch plane, which contains that centreline, also shows
# all three - the "three vessel" sign.
BR1 = 0.5 * (ao_path[2] + ao_path[3])
BR2 = ao_path[3].copy()
BR3 = 0.5 * (ao_path[3] + ao_path[4])
tube("innominate", "Brachiocephalic artery", "vessel",
     [BR1, BR1 + np.array([-0.18, 0.72, 0.28]),
      BR1 + np.array([-0.42, 1.36, 0.46])], 0.13)
tube("lcca", "Left common carotid", "vessel",
     [BR2, BR2 + np.array([0.06, 0.72, 0.26]),
      BR2 + np.array([0.12, 1.32, 0.42])], 0.10)
tube("lsca", "Left subclavian artery", "vessel",
     [BR3, BR3 + np.array([0.55, 0.56, 0.08]),
      BR3 + np.array([1.25, 0.84, 0.12])], 0.11)

# Pulmonary trunk -> LPA / RPA.  RPA passes behind the ascending aorta and is
# seen in cross-section in the suprasternal long-axis arch view.
mpa_path = [PV,
            C(BASE, 0.16, -1.38, 0.82),
            C(BASE, 0.24, -1.54, 1.36)]
tube("mpa", "Main pulmonary artery", "vessel", mpa_path, 0.33,
     taper=[1.0, 1.02, 0.98])
MPA_END = mpa_path[-1]
tube("lpa", "Left pulmonary artery", "vessel",
     [MPA_END, MPA_END + np.array([0.55, -0.20, -0.42]),
      MPA_END + np.array([1.25, -0.42, -0.72])], 0.19,
     taper=[0.9, 0.82, 0.74])
# The RPA passes behind the ascending aorta and beneath the arch, where the
# suprasternal long-axis view cuts it in cross-section under the "candy cane".
tube("rpa", "Right pulmonary artery", "vessel",
     [MPA_END, np.array([-0.18, -0.62, -1.78]),
      np.array([-1.00, -0.58, -1.94])], 0.20,
     taper=[0.9, 0.84, 0.78])

# Ductus arteriosus: MPA/LPA junction -> descending aorta, just distal to the
# left subclavian.  This is the "ductal cut" of the high parasternal view.
DUCT_A = MPA_END + np.array([0.28, -0.10, -0.30])
DUCT_B = AO_ISTHMUS + np.array([0.02, -0.06, 0.04])   # just distal to the LSCA
tube("pda", "Ductus arteriosus (PDA)", "vessel",
     [DUCT_A, 0.5 * (DUCT_A + DUCT_B) + np.array([0.18, 0.12, -0.10]), DUCT_B],
     0.16, taper=[1.0, 0.92, 0.80])

# ---- systemic and pulmonary veins -----------------------------------------
tube("svc", "Superior vena cava", "vessel",
     [C(BASE, -0.88, 0.10, 0.92), np.array([-0.85, -0.55, -1.15]),
      np.array([-0.80, 0.55, -1.25]), np.array([-0.80, 1.30, -1.25])],
     0.24, taper=[1.0, 0.95, 0.90, 0.88])
tube("ivc", "Inferior vena cava", "vessel",
     [C(BASE, -0.80, 0.72, 0.30), np.array([-0.55, -3.30, -1.95]),
      np.array([-0.50, -5.10, -2.05]), np.array([-0.48, -6.40, -2.05])],
     0.26, taper=[1.0, 0.96, 0.92, 0.90])
tube("hepatic_v", "Hepatic vein", "vessel",
     [np.array([-0.52, -4.60, -2.00]), np.array([0.25, -5.05, -1.55]),
      np.array([0.95, -5.30, -1.20])], 0.12, taper=[0.9, 0.8, 0.7])
# The four pulmonary veins enter the posterior left atrium at its corners.
# They are placed in BODY axes (left/right and superior/inferior at a common
# posterior depth) rather than cardiac axes, because that is what makes them
# co-planar in the coronal suprasternal "crab" view where all four are counted.
for nm, lbl, sx, sy in (("lupv", "Left upper pulmonary vein", 1.0, 1.0),
                        ("llpv", "Left lower pulmonary vein", 1.0, -1.0),
                        ("rupv", "Right upper pulmonary vein", -1.0, 1.0),
                        ("rlpv", "Right lower pulmonary vein", -1.0, -1.0)):
    ost = LA_C + np.array([sx * 0.50, sy * 0.34, -0.26])
    tube(nm, lbl, "vessel",
         [LA_C + np.array([sx * 0.18, sy * 0.12, -0.12]), ost,
          ost + np.array([sx * 0.62, sy * 0.18, -0.34])],
         0.105, taper=[0.9, 0.85, 0.78])

# Coeliac trunk / SMA off the abdominal aorta (SCAN slide 23 + perfusion)
tube("celiac", "Coeliac trunk", "vessel",
     [np.array([0.19, -5.62, -2.42]), np.array([0.26, -5.70, -1.95]),
      np.array([0.40, -5.78, -1.58])], 0.085, taper=[0.9, 0.8, 0.7])
tube("sma", "Superior mesenteric artery", "vessel",
     [np.array([0.19, -6.05, -2.42]), np.array([0.22, -6.35, -2.00]),
      np.array([0.24, -6.95, -1.72])], 0.08, taper=[0.9, 0.8, 0.75])

# ---- non-cardiac landmarks used for orientation ---------------------------
S.append({"id": "liver", "label": "Liver", "group": "context", "kind": "shell",
          "tissue": "organ", "axes": [L(1, 0, 0), L(0, 1, 0), L(0, 0, 1)],
          "centre": L(0.05, -6.35, -0.65), "radii": L(3.55, 1.85, 2.05),
          "cavity": L(0, 0, 0), "clip": []})
S.append({"id": "spine", "label": "Vertebral column", "group": "context",
          "kind": "tube", "tissue": "bone",
          "path": [L(0, 1.2, -3.15), L(0, -2.0, -3.30), L(0, -6.8, -3.15)],
          "radius": 0.42, "wall": 0.42, "taper": [1, 1, 1]})

ANATOMY = {
    "units": "cm",
    "frame": {"x": "patient left", "y": "patient superior", "z": "anterior",
              "origin": "suprasternal notch (skin)"},
    "subject": "term newborn, approx 3.4 kg",
    "landmarks": {k: L(*v) for k, v in LM.items()},
    # Outward skin normal at each window.  Used to place the probe on the chest
    # and to read the index mark as a clock position the way an operator does.
    "window_normals": {k: L(*u(v)) for k, v in {
        "ssn": [0, 0.80, 0.60], "supra": [0, 0.82, 0.57],
        "sternal_angle": [0, 0.10, 1.0], "mid_sternum": [0, 0.05, 1.0],
        "xiphisternum": [0, -0.25, 0.97],
        "ps2": [0.24, 0.06, 0.97], "ps3": [0.26, 0.04, 0.96],
        "ps4": [0.30, 0.02, 0.95], "rps4": [-0.28, 0.02, 0.96],
        "apical": [0.60, -0.16, 0.78], "subcostal": [0, -0.56, 0.83],
        "high_ps": [0.22, 0.11, 0.97]}.items()},
    # What an operator calls "12 o'clock" at each window.  At every chest wall
    # window that is toward the head.  In the suprasternal notch it is not: the
    # probe face lies almost horizontal there, so cephalad is nearly parallel to
    # the beam and useless as a clock reference; 12 o'clock is toward the chin,
    # i.e. anterior.  Without this the reported clock position at the notch is
    # meaningless.
    "window_clock_twelve": {
        "supra": L(0, 0, 1), "ssn": L(0, 0, 1),
        "subcostal": L(0, 1, 0), "xiphisternum": L(0, 1, 0),
        "ps2": L(0, 1, 0), "ps3": L(0, 1, 0), "ps4": L(0, 1, 0),
        "rps4": L(0, 1, 0), "apical": L(0, 1, 0), "high_ps": L(0, 1, 0),
        "sternal_angle": L(0, 1, 0), "mid_sternum": L(0, 1, 0)},
    "window_labels": {
        "ps2": "Left 2nd intercostal space, parasternal",
        "ps3": "Left 3rd intercostal space, parasternal",
        "ps4": "Left 4th intercostal space, parasternal",
        "rps4": "Right 4th intercostal space, parasternal",
        "apical": "Cardiac apex, left 4th-5th interspace",
        "subcostal": "Subxiphoid (subcostal)",
        "supra": "Suprasternal notch",
        "high_ps": "High left parasternal (ductal)"},
    "heart": {
        "apex": L(*APEX), "base": L(*BASE),
        "long_axis": L(*eL), "length": round(HEART_LEN, 4),
        "basis": {"p1_left": L(*p1), "p2_posterior": L(*p2), "eL": L(*eL)},
        "valves": {"mv": L(*MV), "tv": L(*TV), "av": L(*AV), "pv": L(*PV)},
    },
    "sections": SECTIONS,
    "aim_points": {
        "base": L(*BASE), "apex": L(*APEX),
        "mid_lv": L(*C(APEX, 0.0, 0.0, 1.55)),
        "ao_root": L(*(AV + 0.45 * u(AO_DIR))),
        "av": L(*AV), "pv": L(*PV), "mv": L(*MV), "tv": L(*TV),
        "la": L(*LA_C), "ra": L(*RA_C),
        # Short-axis levels, quoted as distance from the apex along the long
        # axis: apical 5.5 mm, mid-papillary 11.5 mm, mitral 30 mm, aortic 36 mm.
        "psax_av": L(*AV),
        "psax_mv": L(*C(APEX, 0.0, 0.0, 3.00)),
        "psax_pap": L(*C(APEX, 0.0, 0.0, 1.15)),
        "psax_apical": L(*C(APEX, 0.0, 0.0, 0.55)),
        "arch": L(*ao_path[3]),
        "arch_distal": L(*ao_path[4]),
        "isthmus": L(*AO_ISTHMUS),
        "asc_ao": L(-0.50, -0.95, -1.30),
        "duct": L(*(0.5 * (DUCT_A + DUCT_B))),
        "mpa_bif": L(*MPA_END),
        "ivc_ra": L(*C(BASE, -0.80, 0.72, 0.30)),
        "ivc_mid": L(-0.55, -3.30, -1.95),
        "svc_mid": L(-0.83, -0.30, -1.20),
        "abdo_ao": L(0.19, -5.60, -2.43),
        "desc_ao": L(*ao_path[6]),
        "pulm_veins": L(*(LA_C + np.array([0.0, 0.0, -0.20]))),
        # a point one centimetre to the patient's left of the left atrium, used
        # to force the suprasternal "crab" plane to a coronal orientation
        "la_left": L(*(LA_C + np.array([1.0, 0.0, -0.20]))),
        "lvot_mid": L(*C(BASE, -0.12, -0.34, -0.02)),
    },
    "structures": S,
}

os.makedirs(DATA, exist_ok=True)
json.dump(ANATOMY, open(os.path.join(DATA, "anatomy.json"), "w"), indent=1)

print("heart long axis (apex->base) =", L(*eL), " length %.2f cm" % HEART_LEN)
print("p1 (patient left, in valve plane) =", L(*p1))
print("p2 (posterior; -p2 = anterior)    =", L(*p2))
print("orthonormal check  eL.p1=%.2e  eL.p2=%.2e  p1.p2=%.2e"
      % (np.dot(eL, p1), np.dot(eL, p2), np.dot(p1, p2)))
print("n structures =", len(S))
print("valve spread MV-TV = %.2f cm, AV-PV = %.2f cm"
      % (math.sqrt(float(np.dot(MV - TV, MV - TV))),
         math.sqrt(float(np.dot(AV - PV, AV - PV)))))
