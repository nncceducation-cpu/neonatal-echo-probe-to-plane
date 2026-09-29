// probe.js - the transducer pose, and what it costs you to be off it.
//
// A view is a probe pose: where the transducer touches the chest, which way the
// beam points, and which way the index mark faces.  The imaging plane is a
// consequence of that pose, never the other way round.  Everything the user can
// do to the probe here is something they can do with their hand:
//
//   slide    move the contact point over the skin        (changes the window)
//   sweep    tilt the beam about the index axis          (changes the PLANE)
//   rock     rock the probe within the current plane     (re-aims the sector)
//
// The difference between sweep and rock is not cosmetic and is easy to get
// wrong. Rocking keeps the beam inside the existing imaging plane, so the
// plane - and therefore the cross-section - does not change at all; only the
// part of it the sector covers does. Sweeping tilts the beam out of the plane
// about the index mark, and that is what turns one view into another: PLAX
// into the RV inflow or outflow, four-chamber into five-chamber, and the
// parasternal short axis from base to apex.
//   rotate   turn the transducer about the beam axis      (changes the section)
//   depth    the machine's depth setting                  (changes the sector)

import { add, sub, mul, dot, cross, unit } from './geom.js?v=20260929-8';
import { skinAt } from './body.js?v=20260929-8';

const DEG = Math.PI / 180;

/** Rotate v about the unit axis k by angle a (Rodrigues). */
function rot(v, k, a) {
  const c = Math.cos(a), s = Math.sin(a);
  return add(add(mul(v, c), mul(cross(k, v), s)),
             mul(k, dot(k, v) * (1 - c)));
}

export class Probe {
  constructor(view) {
    this.load(view);
  }

  load(view) {
    this.viewId = view.id;
    this.contact = view.contact.slice();
    this.beam = unit(view.beam);
    // Rounded presets must not shear the shared slice coordinate frame.
    this.index = unit(sub(view.index,mul(this.beam,dot(view.index,this.beam))));
    this.depth = view.depth;
    this.sector = view.sector;
    this.window = view.window;
    return this;
  }

  plane() {
    const n = unit(cross(this.beam, this.index));
    return { origin: this.contact, u: this.index, v: this.beam, n };
  }

  /** Turn the transducer about the beam axis: this is what selects a section. */
  rotate(deg) {
    this.index = unit(rot(this.index, this.beam, deg * DEG));
    return this;
  }

  /**
   * Tilt the beam about the index-mark axis. The index mark stays put and the
   * beam leaves the old plane, so the plane normal changes and a genuinely
   * different cross-section appears. This is the manoeuvre behind every
   * "sweep": PLAX to the RV inflow or outflow, four-chamber to five-chamber,
   * and the parasternal short axis from base to apex.
   */
  sweep(deg) {
    this.beam = unit(rot(this.beam, this.index, deg * DEG));
    return this;
  }

  /**
   * Rock the probe within the current imaging plane. Both the beam and the
   * index mark stay in that plane, so the plane - and therefore the
   * cross-section - is UNCHANGED: this re-aims the sector across the same cut
   * rather than selecting a new one. It is kept distinct from sweep() exactly
   * because conflating the two is the commonest way to misread how a probe
   * movement maps onto the image.
   */
  rock(deg) {
    const n = unit(cross(this.beam, this.index));
    this.beam = unit(rot(this.beam, n, deg * DEG));
    this.index = unit(rot(this.index, n, deg * DEG));
    return this;
  }

  /** Slide the contact point over the skin, keeping the beam aimed as it was. */
  slide(dLeft, dUp) {
    // The selected acoustic window is locked. Sweeping pivots at this point.
    return this;
  }

  setDepth(cm) {
    this.depth = Math.max(2.0, Math.min(12.0, cm));
    return this;
  }

  /**
   * How far this pose is from a target view, in the three things that can be
   * wrong independently: where the probe sits, where it points, and how it is
   * turned.  Reported separately because the correction differs - slide,
   * tilt, or rotate.
   */
  deviation(view) {
    const n = this.plane().n;
    const tn = unit(cross(view.beam, view.index));
    const ang = (a, b) => Math.acos(Math.max(-1, Math.min(1, Math.abs(dot(a, b))))) / DEG;
    const signedAng = (a, b) => Math.acos(Math.max(-1, Math.min(1, dot(a, b)))) / DEG;
    const d = sub(this.contact, view.contact);
    return {
      plane_deg: +ang(n, tn).toFixed(1),
      beam_deg: +signedAng(this.beam, unit(view.beam)).toFixed(1),
      index_deg: +signedAng(this.index, unit(view.index)).toFixed(1),
      contact_mm: +(10 * Math.hypot(d[0], d[1], d[2])).toFixed(1),
    };
  }

  /** Which standard view is this pose closest to? */
  nearest(views) {
    let best = null, bestScore = Infinity;
    for (const v of views) {
      const dv = this.deviation(v);
      // weight the plane orientation most: it is what decides the section
      const score = dv.plane_deg + 0.5 * dv.beam_deg + 0.08 * dv.contact_mm;
      if (score < bestScore) { bestScore = score; best = { view: v, dv, score }; }
    }
    return best;
  }

  /**
   * Plain-language correction toward a target, in the order an operator would
   * apply it: find the window, aim the beam, then turn to the right section.
   */
  advice(view) {
    const d = this.deviation(view);
    const out = [];
    if (d.contact_mm > 6) {
      out.push(`slide ${d.contact_mm.toFixed(0)} mm to the marked window`);
    }
    if (d.beam_deg > 6) out.push(`re-aim the beam by ${d.beam_deg.toFixed(0)}\u00b0`);
    if (d.index_deg > 8) out.push(`rotate the probe by ${d.index_deg.toFixed(0)}\u00b0`);
    if (!out.length) return 'On plane.';
    return out.join('; ');
  }
}

export { rot };
