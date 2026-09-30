# Local teaching reconstruction review

## Latest audit (29 September 2026)

See [CUT_AUDIT.md](CUT_AUDIT.md) for the current per-view findings, source review,
partial repairs and unresolved failures. The historical MV failure below is
superseded by a closed-cavity/no-aorta regression check, not by clinical sign-off.
The project remains an unpublished review draft.

## Current direction: restored 3D cuts (cuts-review-1)

### Open acceptance failure: PSAX mitral level

User correctly identified an outflow-like LV extension. Ascending-aorta mesh
overlap exists at the generic short-axis plane. Prioritizing myocardial wall
over separate vessel solids fixes a renderer overlap bug but not this shape.
A 7-degree locally fitted plane excluded the ascending aorta but retained the
wrong LV outline and introduced more tricuspid tissue; it was visually rejected
and reverted. No no-outflow acceptance pass is claimed. The internal atlas and
valve-landmark geometry need further reconstruction; moving the plane alone is
not a demonstrated fix. Do not publish this draft as anatomically corrected.

User rejected the static illustration approach. Both cut canvases are restored;
the unused illustration files remain available for recovery but are not displayed.
PLAX/A3C/subcostal LVOT planes now contain both MV and AV centres. A4C/subcostal
four-chamber planes contain both AV-junction centres. RVOT planes contain PV and
the MPA centre. These constraints repair landmark misses, not all atlas anatomy.
Thin valve/detail contours are now drawn from identical mesh intersections in
both panels, in addition to sampled tissue. Reviewed SCAN PDF pages 16–18,
the supplied corrected screenshots, and successive PLAX clip frames.
Tests enforce valve-centre intersections and preserve locked probe contacts.
All changes remain local, pending visual/clinical review; not a validated simulator.

## Rejected experiment: option 2 — static illustrations

The rejected live-cut draft below is superseded in the visible teaching panels
by 15 view-specific SVG illustrations. These are non-metric drafts requiring
clinical review, not intersections of the 3D atlas or reconstructions of the clips.
The probe/torso model, recorded clips, Doppler selection and reset remain available.
Probe movement does not alter the reference illustration and is explicitly labeled.
Six other presets show an unavailable-illustration notice, not a substitute diagram.
The original reconstruction implementation remains local for preservation, but its
cut canvas is hidden while the illustration is selected. No deployment was made.

Status: unpublished draft. Public release 20260929-9 is unchanged.

## What changed

- Shared closed leaflet surfaces replace the previous valve geometry in both
  the 3D cut and grayscale section. MV has two components; TV, AV and PV three.
  This is a static diastolic teaching approximation, not measured neonatal anatomy.
- Separate leaflet components are unioned when sampled, avoiding cancellation
  where surfaces overlap. The original binary assets are unchanged.
- Atlas geometry and chamber sampling use the same rigid chest-registration
  transform and inverse. The authored long-axis direction is [-.65,.68,-.35],
  normalized; it is not inferred from patient imaging. The myocardium is kept
  behind the anterior chest. This assumption needs clinical review.
- Short-axis preset contact calibration occurs once when selecting the view.
  Subsequent sweeps/rotations retain fixed contact.
- Vessel contours now contribute to both sections. The wall thickness is
  schematic, not measured. Thin/oblique and branch-junction contours need review.
- Crab fitting targets the LA and four pulmonary-vein meshes. Intersecting all
  four meshes does NOT establish a correct depiction of their atrial junctions.
- A2C fitting penalizes inclusion of TV/AV; A3C passes through MV and AV.

## Engineering checks

Run from repository root:

```
node tools/verify_registered.mjs
node tools/verify_teaching_reconstruction.mjs
node tools/verify_section_geometry.mjs
node tools/verify_probe_lock.mjs
node tools/verify_echo_references.mjs
```

These check inverse registration, closed leaflet meshes, overlap union, expected
valve intersections, short-axis perpendicularity, no valves at papillary/apical
short-axis levels, vein intersections, probe contact locking/reset, and distinct
clinical video/Doppler mappings. They do not certify clinical accuracy.

## Required review before publication

Compare each cut with the instructor's SCAN clips, corrected screenshots and PDF:
PLAX leaflet attachment and lengths; RV inflow/outflow; AV central root and
pulmonary outflow; MV fish-mouth opening; papillary muscle positions; A2/3/4/5C;
subcostal cuts; and crab LA/vein continuity and great-vessel relationships.

The independent recorded clips are not spatially tracked or synchronized to the
static model. The current model cannot reproduce their exact beat or sweep.
The external textured heart remains a separate source, not a registered surface.
Other vessel presets (arch, ductal, caval and abdominal views) are refitted to
the transformed vessel landmarks, but still require visual clinical review.
The source does not contain a resolved ductus; its full anatomy is not recreated.

No GitHub push or public deployment is authorized by this review checkpoint.
