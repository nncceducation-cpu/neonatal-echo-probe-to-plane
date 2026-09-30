# Cut audit — 29 September 2026

Status: **partially corrected local review draft; not ready for publication.**
Engineering checks are not clinical validation. No view below has clinical sign-off.

## Arch / ductal follow-up — local `arch-duct-2`

The arch and two ductal presets now explicitly select a **vessel-only 3-D
teaching reconstruction**. This is a scoped alternative, not a completed repair
of the whole-heart atlas. The original chamber, valve and vessel meshes remain
unchanged for every other preset. The full cardiac orientation model stays on
the torso. The UI states that chambers are omitted from the vascular cuts.

Reference review used SCAN PDF pages 29–30, sequential frames of the supplied
arch/ductal recordings, and ASE 2024 Figures describing the arch and high-left
parasternal ductal window. The reference establishes anatomical relationships,
**not the numerical coordinates or vessel dimensions authored in this model**.

Implemented: a connected ascending–transverse–proximal descending aortic path;
three separate arch branches; RPA passing under the arch; distinct MPA, LPA and
RPA paths; a patent ductus joining distal MPA to proximal descending Ao distal
to the left subclavian origin. Inner and outer surfaces are intersected by the
same live plane in both panels. Lumen union removes artificial walls at joins.
Arch and sagittal ductal planes are separate, and the oblique ductal preset
intersects the LPA/ductal region. Camera/fan fitting uses proximal vessels rather
than the whole descending thoracic aorta or the ventricles.

Important limitation: initial whole-heart integration tests produced vessel /
chamber overlaps. That integration was **not retained**. The vascular field is
therefore isolated and labelled; it does not establish correct LA, LV or valve
relationships around these vessels, and does not reproduce all tissue in the
echo clips. Continuous full-heart registration remains unresolved. Diameters,
branch angles, static shape and contact positions require instructor review.
The ductus is an explicit patent teaching example, not a normality claim.

Seven engineering verification scripts pass, including the new
`verify_vascular_cuts.mjs`: continuous arch lumen; three branch lumen sections;
PA–ductus–Ao connectivity; no internal junction wall; live recutting on sweep;
skin contacts; native vessel arrays unchanged outside these three views; and
return to the cardiac model. Browser checks confirmed arch/ductal rendering,
restored full-heart torso overview, return to the existing MV cut, and correct
ductal 2-D/Doppler source switching. No public deployment was performed.

The table below records the previous whole-heart audit; its unresolved
whole-heart findings are **not superseded by the vessel-only alternative**.

## Evidence used

- Instructor-provided corrected screenshots: PLAX; short-axis aortic, mitral,
  papillary levels; apical 2/3/4/5 chamber; subcostal four-chamber; crab references.
- `Cardiac SCAN.pdf`, especially pages 16–18 (three short-axis levels), 29
  (arch) and 30 (ductal view). Several other pages contain blank embedded-video
  placeholders when rendered; their anatomy was reviewed from separate MP4s,
  not inferred from those blank boxes.
- Sequential frames from the supplied PLAX, RV inflow/outflow, three SAX levels,
  A5C, subcostal four-chamber/LVOT/RVOT, arch and ductal MP4s. Contact sheets are
  local review evidence under `docs/echo-review/scan-*-cycle.jpg`. These sample
  the short recordings; they are not time-registered to the static model.
- [ASE comprehensive pediatric TTE guideline, 2024](https://www.asecho.org/wp-content/uploads/2024/02/2024-Peds-TTE_PIIS0894731723006223.pdf):
  standard windows, apical outflow sweeps, ductal relationships and suprasternal
  pulmonary venous assessment. The crab view must demonstrate pulmonary venous
  connections to the LA, not merely intersect four vein meshes.
- [European neonatal echocardiography introductory consensus, 2018](https://pmc.ncbi.nlm.nih.gov/articles/PMC6257222/):
  separate short-axis valve/papillary levels; PLAX inflow/outflow sweeps;
  four-chamber versus anteriorly angled five-chamber acquisition.

## Root causes identified

1. The coarse LV/LA and RV/RA ownership labels were treated as bright tissue
   edges, inventing lines across open blood pools. These are now ignored as
   tissue boundaries in the educational rendering.
2. The imported MV landmark is a whole leaflet/chordal centroid, not a measured
   annular centre. The old generic SAX level cut through basal outflow anatomy.
3. The estimated aortic landmark lay in the artery mesh's sealed tapered tip.
   The root is now fitted to a complete vessel contour before cusp placement.
4. A desired cut normal could be silently changed to accommodate a fixed skin
   point. Selected corrected presets now preserve the anatomical plane and
   solve an initial contact on the schematic skin. Subsequent movement remains
   fixed-contact. External surface/torso registration still needs clinical review.
5. The external textured heart and internal atlas are different sources. The
   coarse chamber grid and separate vessel surfaces do not guarantee correct
   inflow/outflow or pulmonary-vein junction topology.

## View-by-view findings

| View | Change/check in this pass | Remaining acceptance requirement |
|---|---|---|
| PLAX | Plane contains apex, MV and AV; two MV profiles; false label seam removed | Detached-looking MV profiles remain; leaflet attachments and LVOT continuity are not accepted |
| RV inflow | TV and right-sided section retained; no false RA/RV seam | TV leaflet proportions/attachment not validated |
| RV outflow | PV intersects; pulmonary vessel section retained | Too much LV in the current cut; RV→PV→MPA continuity still inadequate |
| SAX AV | Root centre/diameter fitted; three shared cusp surfaces; near-en-face root with small pulmonary sweep | RV/RA/LA proportions, TV visibility and pulmonary lumen continuity not signed off |
| SAX MV | Inflow-frame leaflet-body level; real closed LV wall contour; no ascending aorta or basal valves; both MV components | Orifice proportions, attachments and RV shape remain approximate |
| SAX papillary | Deeper plane along inflow frame intersects both LV papillary heads and no valves | Papillary positions relative to opposite LV walls differ from supplied correction |
| SAX apical | No valve intersections retained | Residual papillary tissue/level needs refinement; attempted more apical plane lost LV cavity and was rejected |
| SAX ductal/PDA | Fit includes pulmonary/descending-aortic vessel targets | Actual ductus absent from the registered atlas; cannot claim a correct ductal cut |
| Apical 4C | Plane contains apex and both AV junctions | Annular offset/leaflet attachment and proportions need review |
| Apical 5C | Existing LVOT-containing draft retained | TV/right inflow missing. Weighted all-junction trial lost AV and was rejected, not shipped |
| Apical 3C | Plane contains apex, MV and AV | LVOT continuity and leaflet profiles need review |
| Apical 2C | Plane rotated about LV axis; LV+LA retained, large RV/RA section removed | Detached-looking MV profiles remain; annular attachment is not accepted |
| Subcostal 4C | Plane through apex and both AV junctions; contact solved on skin | Right/left chamber proportions and acquisition window need review |
| Subcostal LVOT | MV/AV centre intersections retained, false seam removed | Actual vessel continuity/leaflet attachment not validated |
| Subcostal RVOT | PV retained | Excess LV/MV intersection; not accepted |
| Subcostal IVC | Vessel-aware fit added; existing caval preset preserved | RA/IVC junction and longitudinal vessel course not validated |
| Subcostal abdominal aorta | Vessel-aware fit added | Cut remains too cardiac (TV intersection); needs true abdominal geometry/window |
| Suprasternal arch | Vessel-aware fit added, avoids fitting myocardium alone | Continuous arch centreline and branch origins not established |
| Suprasternal crab | Four vein meshes intersect; vessel-aware fit added | LA-to-vein ostial continuity is wrong; intersections alone do not pass |
| High parasternal ductal | Vessel-aware fit added; supplied clip/Doppler retained | Missing ductus geometry; not accepted |
| SVC long axis | Vessel-aware fit added | Full longitudinal SVC/RA course requires review |

## What is verified

`tools/verify_cut_acceptance.mjs` adds regression checks for a real closed MV-level
LV contour (not a line drawn across an opening), aortic exclusion at MV level,
both MV components, both papillary muscles without valves, absence of a substantial
RV/RA chamber section in A2, three aortic cusp components plus pulmonary outflow
intersection, and no bright false atrial/ventricular label seams.

Additional tests cover inverse registration, closed leaflet surfaces, exact wall
priority, vessel/leaflet overlap, 21 fixed probe contacts through sweep/rotate/rock
and reset, distinct SAX clips, and existing Doppler mappings. Tests passing does
not make the unresolved rows anatomically correct.

All six verification scripts passed in this local pass. Browser checks confirmed
the MV closed-cavity change, AV three-seam display, A2 absence of the large RV,
distinct papillary clip, PLAX Doppler switch, interactive sweep with zero contact
drift, and reset to zero angular deviation. Quiz controls remained accessible;
this is not a clinical audit of quiz questions. Browser review also confirmed
the detached-looking MV profiles and incorrect papillary arrangement recorded
above. These defects must not be softened into an acceptance pass.

Both display panels use the same section geometry. The separate aortic drawing
overlay is no longer invoked. Static AV and MV leaflet states are not a synchronized
cardiac cycle, and the model must not be presented as reproducing the clip frame.

## Required next reconstruction work

Before release, correct internal topology and landmarks in a coherent shared
3D model: connected ventricular outflows, measured annular frames, leaflet
attachments, pulmonary-vein ostia and the ductal connection. Then repeat this
view matrix with instructor sign-off. The supplied independent 2D clips are
excellent visual references but do not provide tracked volumetric geometry;
they cannot justify claiming a patient-matched 3D reconstruction.

No public site was changed by this audit.

## Clip-display orientation pass (2026-09-29)

Reviewed the linked PLAX/inflow/outflow, SAX AV/MV/papillary, apical 4C/5C,
subcostal 4C/LVOT/RVOT, arch and ductal cine contact sheets. This pass changes
display coordinates only; it does not change the scan planes, probe contacts,
chamber mesh, valve surfaces, source clips or the limitations listed above.

- Apical 4C/5C and the three linked subcostal views use probe-end-down / beam-up
  display, matching those recordings. A5C also mirrors horizontally to place
  the LV on the right, as in its supplied recording.
- Linked parasternal/SAX, arch and ductal views retain beam-down display.
- Unlinked views retain their existing orientation rather than borrowing an
  unverified flip from another view.
- Both cut panels now share the display transform even with playback hidden,
  during Doppler switching, and in quiz/free-probe modes. The manual mirror
  remains an additional reversible horizontal flip.
- Educational tissue samples, valve sections, sector outline, depth ticks and
  index marker use the same transform. Text remains upright. The 3D camera uses
  the equivalent screen basis without rotating the physical probe or torso.

`verify_cut_orientation.mjs` checks defaults, manual reversal, panel wiring,
fan direction and projection inverses. Existing geometry/probe/media tests
remain applicable. Flipping does **not** correct obliquity, absent structures,
or the unresolved A5C/RVOT topology. This is not anatomical acceptance.
