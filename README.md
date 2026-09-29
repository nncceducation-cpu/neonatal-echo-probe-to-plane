# Neonatal echo: probe to plane

## Shared educational app

Open https://nncceducation-cpu.github.io/neonatal-echo-probe-to-plane/

Includes the textured neonatal surface, section-facing camera, locked probe
windows, mouse/touchpad slicing, supine overview, responsive Standard Views and
Controls panels, quiz mode, and five recorded echo references. The source
recordings are published with the project owner's explicit authorization.
See `THIRD_PARTY_NOTICES.md` for asset-specific licensing; the software MIT
license does not relicense the clinical media or anatomical datasets.

## Registered-anatomy section model

This checkout now loads the included BodyParts3D-derived `heart.bin`,
`heart_meta.json`, `chambers.bin`, and `frame.json` by default. The 3D heart is
the registered external mesh; its red/blue cut face and the grayscale chamber
panel sample the same chamber-label volume. The PLAX, apical four-chamber,
subcostal long-axis, and four parasternal short-axis presets are fitted to
the registered heart rather than simply reusing the idealised geometry's pose.
`node tools/verify_registered.mjs` checks the principal chamber intersections.

The ultrasound panel offers five supplied recorded studies matched to selected
presets. These are independent recordings, not dynamically generated echo
frames or a patient-matched registration. Unsupported views have no fallback.

Limitations: the registered source is an adult anatomical atlas scaled to a
term-newborn frame, not neonatal patient imaging. Its chamber grid does not
encode all valve leaflets, septal details, vessel lumens, ultrasound physics,
cardiac motion, or Doppler. The remaining presets still use the original
idealised probe poses and require registration-specific clinical review. The
grayscale display is a labeled anatomical section, not a realistic sonogram.

An interactive 3-D neonatal heart in which **every standard echocardiography
view is generated from a real transducer pose** — the window you put the probe
on, the direction you aim it, and the way you rotate it. The cut plane is a
consequence of the probe; it is never a plane picked in world coordinates and
then decorated with a view name.

Two panels, always in step: the 3-D scene shows the probe, the imaging plane and
the cut surface of the heart; the echo panel shows what would appear on the
screen. Both are drawn from the *same* cross-section computation, so they cannot
disagree with each other.

---

## The idea the app is built on

The teaching framework is the one in the SCAN workshop material: every standard
view is **one of three cardiac sections, taken from one of four windows**.

| | |
|---|---|
| **Sections** (defined against the heart's own long axis, *not* the body's) | long axis · short axis · four chamber |
| **Windows** (where the probe touches the chest) | parasternal · apical · subcostal · suprasternal |

The section is the part that is easy to get wrong, and it is the reason a heart
sliced along body axes looks nothing like an echo. The heart's long axis runs
from the apex (left, inferior, anterior) to the base (right, superior,
posterior) — in this model 33.7 mm long, tilted away from every body axis. So:

* the **long-axis** section contains that axis,
* the **four-chamber** section also contains it, rotated 90° about it,
* the **short-axis** sections are perpendicular to it.

Once sections are defined that way, some results fall out of the geometry rather
than having to be asserted — and they match what the source material says:

* The **apical long-axis (3-chamber)** view is the *same cardiac section* as
  **PLAX**, just seen from the apex instead of the parasternum. The app computes
  both at a rotation of 0.0° from the long-axis section.
* The **subcostal long-axis** plane comes out 0.0° from the **four-chamber**
  plane — which is exactly why the deck calls it "equivalent to the 4-chamber
  view".
* The **five-chamber** view *cannot* be a rotation: the aortic valve sits about
  23° off the long-axis plane, so no plane containing the long axis passes
  through it. It has to be an anterior **tilt**, and it buys the aorta at the
  cost of the tricuspid valve.

## What the probe can do

Each control is something a hand can do, and each changes a different thing:

| Control | Keys | What it changes |
|---|---|---|
| **Rotate** about the beam axis | `Q` / `E` | the **section** — this is what turns A4C into A3C |
| **Sweep**: tilt about the index axis | `W` / `S` | the **plane** — PLAX to RV inflow, A4C to A5C, base-to-apex short axis |
| **Rock**: tilt within the plane | `A` / `D` | **nothing about the plane** — re-aims the sector across the same cut |
| **Slide** over the skin | arrows | the **window** |
| **Depth** | slider | how much of the plane is on screen |

The sweep/rock distinction is worth dwelling on, because conflating the two is
the commonest way to misread how a probe movement maps onto the image. Rocking
keeps the beam inside the existing plane, so the cross-section does not change
at all. Sweeping tilts the beam out of the plane, and that is what turns one
view into another.

In **free probe** mode the app reports how far you are from the target view,
split into the three things that can be independently wrong — where the probe
sits, where it points, and how it is turned — because the correction differs:
slide, re-aim, or rotate.

## Views covered (21)

**Parasternal** — long axis; RV inflow sweep; RV outflow sweep; short axis at
the aortic-valve, mitral, mid-papillary and apical levels; ductal cut for the
PDA.
**Apical** — four, five, three (apical long axis) and two chamber.
**Subcostal** — long axis (four-chamber equivalent); aorta / LV outflow;
pulmonary artery / RV outflow; sagittal IVC; sagittal abdominal aorta with
coeliac and SMA.
**Suprasternal / high parasternal** — longitudinal aortic arch with all three
head and neck vessels; short-axis "crab" view of the left atrium and pulmonary
veins; high parasternal ductal view; SVC long axis.

Each carries its window, index-mark direction, depth, sector, expected
structures, the manoeuvre in words, and the pitfall that view is known for.

## Conventions

* **Patient frame**, right-handed, centimetres: **+X** patient left, **+Y**
  cephalad, **+Z** anterior. Origin at the **suprasternal notch**.
* **Index mark maps to the right of the image** (cardiology convention). There
  is a mirror toggle for the other convention.
* Index-mark directions are given in **plain anatomical terms** rather than as
  clock positions. A clock position needs a 12 o'clock reference on the probe
  face, and that reference is genuinely ambiguous in the suprasternal notch
  where the face lies almost horizontal.
* Where a source states a pointer position it is quoted and attributed **on the
  view itself**, with its provenance, because the three available statements do
  not come from the same place:
  * subcostal IVC — "Pointer 12 o'clock", **slide 22** of the deck;
  * longitudinal aortic arch — "12–1 o'clock", **slide 29** of the deck;
  * suprasternal "crab" — "upper 1/3rd sternum, pointer 9 o'clock", read off the
    title card of the **recorded lecture** at about 20:13, not from the deck.
    The deck does not contain the word "crab" or describe this view at all.
* Everything else is a **house convention**, marked as such in the view's
  `index_note`. Two views carry one: the arch view's cephalad orientation is an
  interpretation of the deck's clock figure, and the SVC view's matching
  orientation is chosen only so the two sagittal suprasternal views are not
  mirror images of each other.

## How the geometry is built and checked

Anatomy is declared **analytically**, not sculpted: ellipsoid shells for the
chambers, lofted crescents for the right ventricle and the interventricular
septum, swept tubes for the vessels and valves. Two generators emit the data
the app reads:

```
python build_anatomy.py     # -> site/data/anatomy.json   (33 structures)
python build_views.py       # -> site/data/views.json     (21 view poses)
```

Nothing is hand-typed that can be computed: the cardiac basis, the valve
positions, the arch curve and every probe pose are derived.

Verification runs **the app's own code**, not a re-implementation:

```
python tools/verify_planes.py            # 21/21 views pass
python tools/smoke_test.py               # 16/16 checks pass
python tools/contact_sheet.py            # -> docs/contact_sheet.svg
python tools/render_png.py               # -> docs/contact_sheet.png
```

`verify_planes.py` loads `site/js/geom.js` and `site/js/slicer.js` into a
QuickJS interpreter and asks them what each view's plane actually cuts. A Python
re-implementation could agree with itself while the shipped app was wrong; this
cannot. For every view it checks that each expected structure is visible
**inside the sector wedge**, that no excluded structure is, and that the plane
still satisfies the geometric contract it was built from.

That the check is against the sector rather than the infinite plane matters: a
real image is a limited fan, and several views only make sense once you stop
asking "does the plane cross this structure" and start asking "is it on screen".

`smoke_test.py` stands in for a browser as far as anything can without one. It
checks that every element id `app.js` reaches for exists in `index.html` and
that nothing is wired but unused; that every `THREE.*` symbol `scene3d.js` uses
is actually exported by the vendored build, including the two chained calls it
assumes return `this`; and then it loads the geometry, slicing, probe and sector
modules behind a stubbed 2-D canvas and **runs** them — building the anatomy,
slicing all 21 views, drawing each one twice with every display option flipped,
and putting the probe through every manoeuvre from every view.

Two of its assertions are there to stop a specific mistake coming back:
**rocking must leave the imaging plane bit-for-bit unchanged, and sweeping must
change it.** Those two manoeuvres are easy to conflate in code as well as at
the bedside, and if they are ever conflated again the test fails.

## Honest limitations

* The heart is a **synthesised idealised term newborn**, not segmented patient
  imaging. Cross-sections are schematic-accurate — correct structures, correct
  relative positions, correct orientation conventions — not image-accurate.
* **Four views carry a documented limitation** where the idealised geometry and
  a real acquisition differ. The app shows the note rather than quietly fudging
  the model:
  * *parasternal short axis, aortic-valve level* — the exact short-axis plane at
    this level passes above the tricuspid funnel, so the tricuspid valve is not
    drawn here even though a real basal cut shows it;
  * *apical five chamber* — a genuine anterior tilt rather than a rotation, so
    it trades the tricuspid valve for the aorta;
  * *PLAX RV inflow* and *PLAX RV outflow* — these are sweeps rather than
    discrete planes, so what is on screen depends where you stop. Their
    exclusion lists are deliberately narrower than the other views': only the
    structures whose disappearance actually tells you the sweep has arrived are
    listed as absent.
* The torso is a **reference body** for probe placement and orientation. Its
  proportions are not anthropometric, and the model prioritises correct cardiac
  and great-vessel geometry relative to the acoustic windows over whole-torso
  accuracy. Deep posterior structures are correspondingly approximate.
* There is **no Doppler, no flow and no cardiac motion**. The views that exist
  to align a Doppler beam say so in their teaching text, but the app will not
  show you a velocity trace.
* Probe control is by **buttons and keys** rather than dragging the probe over
  the chest.
* The page was **not** loaded in a browser during authoring — no browser could
  be installed in the build sandbox. What *is* verified without one: the plane
  geometry of all 21 views, the DOM and three.js contracts, and the actual
  execution of the geometry, slicing, probe and 2-D sector code behind a
  stubbed canvas (`tools/smoke_test.py`). What is **not**: WebGL rendering,
  three.js scene construction, and layout. So if something fails to draw, the
  3-D panel is the first place to look — the echo panel's logic has been run.

A teaching model. **Not a diagnostic tool, and not patient data.**

## Layout

```
index.html              the app
css/app.css
js/geom.js              analytic primitives -> triangles   (no three.js)
js/slicer.js            plane x mesh -> closed contour loops (no three.js)
js/sector.js            the 2-D echo panel
js/scene3d.js           the 3-D panel, probe, cut caps
js/probe.js             transducer pose and deviation
js/body.js              the reference torso surface
js/app.js               wiring
js/vendor/              three.js r186, vendored - no CDN, works offline
data/anatomy.json       33 structures, generated
data/views.json         21 view poses, generated
docs/verification.json  machine-readable verification report
docs/contact_sheet.*    all 21 views, rendered for review
```

`geom.js` and `slicer.js` deliberately import nothing. That is what lets the
geometry be exercised outside a browser — and it is why the verification can run
the shipped code rather than a copy of it.

## Adding a view

Add an entry to the `V` list in `build_views.py` naming the window, the plane
rule, what the beam aims at, which side of the image the index mark maps to, and
the structures you expect to see and not to see. Re-run both generators and the
verifier; the verifier will tell you if the plane does not do what you claimed.

## Credits

The reference panel now plays five locally downloaded cine studies from the
user's Cardiac cases Drive folder instead of probe diagrams or generic stills.
See `docs/echo-study-review.md` and `js/echo-references.js` for the source IDs,
visual-review assignments and uncertainty. References require the preset pose;
moving off-plane pauses and hides playback. No unrelated fallback is shown.
The project owner authorized public inclusion of the supplied clips on 2026-09-29.

During slicing, the camera follows the cut face perpendicular to the plane,
with the same lateral/depth orientation as the ultrasound panel (including
the display-mirror setting). The near half is removed and the torso is hidden
while cut-follow is active. “Mouse: orbit” releases the camera; “Mouse: slice”
restores cut-follow. Whole-heart mode retains the supine overhead view.

Interaction update: each selected view locks its probe contact. Drag vertically
on the 3D canvas or scroll/two-finger scroll to sweep; drag horizontally to
rotate. Switch “Mouse: slice” to “Mouse: orbit” for camera controls. Arrow keys
also sweep/rotate. The default anterior (+Z) camera looks down onto the supine
torso, head toward screen top. Available supplied reference images appear in
the ultrasound panel via “Show clinical reference”; they are static references,
not generated from the current probe pose. Moving the probe returns to live mode.
Run `node tools/verify_probe_lock.mjs` to verify locked-contact kinematics.

The default external view uses **Normal Neonatal Heart**, E-learning UMCG,
licensed CC BY-NC-SA 4.0, with its original surface textures. This is a separate
surface asset, not a registration to the BodyParts3D chamber volume. Selecting
a section switches to the existing teaching section model; these cuts are not
validated diagnostic ultrasound. “Whole textured heart” returns to the surface.
Keep attribution and noncommercial/share-alike terms with this asset.

Both sidebars scroll independently. At compact widths, the header's **Views**
and **Controls** buttons open the corresponding panel. Probe movement and depth
controls appear above reference material. The camera fits the available canvas.

Teaching framework, view list and clinical emphasis follow the SCAN
(Sonographic Clinical Assessment of Newborn) workshop material and an
accompanying recorded lecture on point-of-care cardiac ultrasound in neonates.
Rendering uses [three.js](https://threejs.org) (MIT).
