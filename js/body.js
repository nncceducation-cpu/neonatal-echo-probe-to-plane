// body.js - the schematic newborn torso the probe sits on.
//
// Kept separate from the three.js scene so that the probe kinematics (and the
// offline verification) can use the skin surface without a renderer.
//
// The trunk is an ellipse per transverse level, tapering into the neck above
// and the abdomen below.  Its anterior surface is what carries the four
// acoustic windows.  This is a reference body for probe placement and
// orientation, not an anthropometric torso.

/** Cross-section of the trunk at height y (cm, patient frame). */
export function torsoSurface(y) {
  const neck = 1 / (1 + Math.exp(-(y - 0.85) * 2.6));      // ~0 below, ~1 above
  const s = (1 - 0.63 * neck) * (y < -6.6 ? 0.93 : 1.0);
  return { a: 4.6 * s, c: 3.4 * s, zc: -2.6 + 1.25 * neck };
}

/**
 * Point on the skin at transverse offset x and height y.
 * Used when the probe is slid over the chest: the contact point stays on the
 * body rather than floating away from it.
 *
 * x/a is clamped just inside +/-1 rather than at +/-1. At the exact lateral
 * tangent the surface normal turns purely transverse and the probe's frame
 * degenerates, so sliding all the way to the side of the chest would leave the
 * beam direction undefined. The clamp stops the slide about 10 degrees short of
 * that point, which is also past any real acoustic window.
 */
export function skinAt(x, y) {
  const { a, c, zc } = torsoSurface(y);
  const xa = Math.max(-0.985, Math.min(0.985, x / a));
  const t = Math.asin(xa);
  return [a * Math.sin(t), y, zc + c * Math.cos(t)];
}
