// sector.js - draw the 2-D echo image from the cross-section.
//
// The panel is not a picture of the 3-D scene: it is the same contour loops the
// slicer produced, drawn in the imaging plane's own frame with the conventions
// of an ultrasound display.  The transducer face sits at the apex of the
// sector, depth increases downward, and the transducer index mark maps to the
// RIGHT of the image (cardiology convention).  That is what makes the panel
// answer the question the deck cares about: given where I put the probe and
// how I turned it, what will I see on the screen?

// Tissue appearance.  Blood pool is near-black, myocardium mid-grey, valves
// and vessel walls bright - the acoustic impedance ordering of a real image.
const TISSUE = {
  myocardium: { fill: '#6d6a67', edge: '#cfc9c2' },
  blood:      { fill: '#0b0d10', edge: '#4a5058' },
  valve:      { fill: '#d8d2c8', edge: '#f2eee7' },
  vessel:     { fill: '#8a8580', edge: '#ded7ce' },
  organ:      { fill: '#3a3835', edge: '#6e6963' },
  bone:       { fill: '#e8e4dc', edge: '#ffffff' },
};

// Bone is deliberately never filled in the 2-D panel.  A vertebral body does
// not image as a bright slab of tissue: the near surface reflects almost
// everything and the far side is acoustic shadow.  Drawing it as filled tissue
// swamps the subcostal and suprasternal views with a white block that no real
// image contains, so it is left to the 3-D panel as an orientation landmark.
export const SKIP_2D = new Set(['spine']);

// Painted back to front, so a structure drawn later reads as lying in front of
// the ones before it.  This is what makes the septum appear between the two
// ventricular cavities without any 3-D boolean arithmetic.
export const PAINT_ORDER = [
  'spine', 'liver',
  'aorta', 'ivc', 'svc', 'hepatic_v', 'celiac', 'sma',
  'mpa', 'lpa', 'rpa', 'pda', 'innominate', 'lcca', 'lsca',
  'lupv', 'llpv', 'rupv', 'rlpv',
  'la', 'ra', 'ias',
  'rv', 'lv', 'ivs', 'pap_al', 'pap_pm',
  'lvot', 'rvot', 'mv', 'tv', 'av', 'pv',
];

function speckleTile(size = 128) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    // multiplicative Rayleigh-ish speckle: mostly mid, with bright flecks
    const u = Math.random();
    const v = Math.min(255, 90 + 150 * Math.sqrt(-2 * Math.log(1 - u)) * 0.35);
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}

let SPECKLE = null;

export class SectorView {
  constructor(canvas) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d');
    this.opts = { speckle: true, labels: true, invert: false, grid: true };
  }

  /** Map plane centimetres to canvas pixels. */
  _fit(depth, sectorDeg) {
    const { width: W, height: H } = this.canvas;
    const pad = 34;
    const half = (sectorDeg * Math.PI) / 360;
    // the sector spans 2*depth*sin(half) across and depth deep
    const sx = (W - 2 * pad) / (2 * depth * Math.sin(half));
    const sy = (H - pad - 22) / depth;
    const s = Math.min(sx, sy);
    return { s, ox: W / 2, oy: pad, W, H };
  }

  _path(loop, f, close = true) {
    const g = this.g;
    g.beginPath();
    loop.forEach((p, i) => {
      const x = f.ox + p[0] * f.s * (this.opts.invert ? -1 : 1);
      const y = f.oy + p[1] * f.s;
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    });
    if (close) g.closePath();
  }

  _sectorPath(depth, sectorDeg, f) {
    const g = this.g;
    const half = (sectorDeg * Math.PI) / 360;
    const near = 0.18;                       // small flat transducer footprint
    g.beginPath();
    g.moveTo(f.ox - near * f.s * Math.sin(half), f.oy + near * f.s);
    g.arc(f.ox, f.oy, depth * f.s, Math.PI / 2 - half, Math.PI / 2 + half);
    g.closePath();
  }

  /**
   * Render one frame.
   * slices  - output of sliceAll(), any order
   * view    - the view record (depth, sector, name, index/clock, image_right)
   * extras  - { highlight:Set<id>, title:string }
   */
  draw(slices, view, extras = {}) {
    const g = this.g;
    const { depth, sector } = view;
    const f = this._fit(depth, sector);
    if (!SPECKLE && this.opts.speckle) SPECKLE = speckleTile();

    g.save();
    g.fillStyle = '#05070a';
    g.fillRect(0, 0, f.W, f.H);

    // everything anatomical is clipped to the sector wedge
    g.save();
    this._sectorPath(depth, sector, f);
    g.clip();
    g.fillStyle = '#0a0c10';
    g.fillRect(0, 0, f.W, f.H);

    const byId = new Map(slices.map((r) => [r.id, r]));
    const order = PAINT_ORDER.filter((id) => byId.has(id))
      .concat(slices.map((r) => r.id).filter((id) => !PAINT_ORDER.includes(id)));

    for (const id of order) {
      if (SKIP_2D.has(id)) continue;
      const r = byId.get(id);
      const t = TISSUE[r.tissue] || TISSUE.myocardium;
      const hot = extras.highlight && extras.highlight.has(id);
      for (const loop of r.outer) {
        this._path(loop, f);
        g.fillStyle = hot ? '#b9d8ff' : t.fill;
        g.fill();
        g.strokeStyle = hot ? '#eaf4ff' : t.edge;
        g.lineWidth = hot ? 2.0 : 1.1;
        g.stroke();
      }
      for (const loop of r.cavity) {
        this._path(loop, f);
        g.fillStyle = TISSUE.blood.fill;
        g.fill();
        g.strokeStyle = hot ? '#dcecff' : t.edge;
        g.lineWidth = 0.9;
        g.stroke();
      }
    }

    if (this.opts.speckle) {
      g.globalCompositeOperation = 'overlay';
      g.globalAlpha = 0.5;
      const pat = g.createPattern(SPECKLE, 'repeat');
      g.fillStyle = pat;
      g.fillRect(0, 0, f.W, f.H);
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'source-over';
    }
    g.restore();                                   // release the sector clip

    // sector outline, depth scale, orientation marker
    this._sectorPath(depth, sector, f);
    g.strokeStyle = 'rgba(150,170,200,0.35)';
    g.lineWidth = 1;
    g.stroke();

    if (this.opts.grid) {
      g.strokeStyle = 'rgba(150,170,200,0.22)';
      g.fillStyle = 'rgba(190,205,225,0.75)';
      g.font = '10px ui-monospace, monospace';
      const half = (sector * Math.PI) / 360;
      for (let d = 1; d <= Math.floor(depth); d++) {
        const x = f.ox - d * f.s * Math.sin(half) - 6;
        const y = f.oy + d * f.s * Math.cos(half);
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + 6, y); g.stroke();
        g.fillText(`${d}`, x - 11, y + 3);
      }
      g.fillText('cm', f.ox - depth * f.s * Math.sin(half) - 22, f.oy + 10);
    }

    // The orientation marker: real machines put a dot or 'V' on the side of the
    // image that corresponds to the transducer index mark.
    const side = this.opts.invert ? -1 : 1;
    const half = (sector * Math.PI) / 360;
    const mx = f.ox + side * (0.72 * depth * f.s * Math.sin(half));
    g.fillStyle = '#ffd24a';
    g.beginPath();
    g.moveTo(mx, f.oy + 6); g.lineTo(mx - 6, f.oy - 5); g.lineTo(mx + 6, f.oy - 5);
    g.closePath(); g.fill();
    g.font = '11px ui-monospace, monospace';
    g.fillText('index', mx + 10, f.oy + 2);

    if (this.opts.labels) this._labels(slices, view, f, extras);
    g.restore();
  }

  _labels(slices, view, f, extras) {
    const g = this.g;
    const placed = [];
    const cands = [];
    for (const r of slices) {
      if (r.group === 'context' || r.group === 'flow') continue;
      // label the largest loop of each structure, at its centroid
      let best = null, bestA = 0;
      for (const loop of r.outer.concat(r.cavity)) {
        let a = 0, cx = 0, cy = 0;
        for (let i = 0, n = loop.length; i < n; i++) {
          const p = loop[i], q = loop[(i + 1) % n];
          const cr = p[0] * q[1] - q[0] * p[1];
          a += cr; cx += (p[0] + q[0]) * cr; cy += (p[1] + q[1]) * cr;
        }
        a /= 2;
        if (Math.abs(a) > bestA && Math.abs(a) > 0.03) {
          bestA = Math.abs(a);
          best = [cx / (6 * a), cy / (6 * a)];
        }
      }
      if (best) cands.push({ r, pt: best, area: bestA });
    }
    cands.sort((a, b) => b.area - a.area);
    g.font = '600 11px ui-sans-serif, system-ui, sans-serif';
    g.textBaseline = 'middle';
    for (const c of cands) {
      const x = f.ox + c.pt[0] * f.s * (this.opts.invert ? -1 : 1);
      const y = f.oy + c.pt[1] * f.s;
      if (placed.some((p) => Math.hypot(p[0] - x, p[1] - y) < 26)) continue;
      placed.push([x, y]);
      const txt = SHORT[c.r.id] || c.r.id.toUpperCase();
      const w = g.measureText(txt).width;
      g.fillStyle = 'rgba(6,10,16,0.62)';
      g.fillRect(x - w / 2 - 3, y - 7, w + 6, 14);
      g.fillStyle = (extras.highlight && extras.highlight.has(c.r.id))
        ? '#9fd0ff' : '#eef3fa';
      g.fillText(txt, x - w / 2, y);
    }
  }
}

// Short labels for the sector panel.  The SCAN deck's own echo stills label
// LA, LV, RA, RV, IAS, TV, PDA, IVC and Ao; where the deck spells a structure
// out in full (for example "Celiac Trunk", "Superior Mesenteric Artery") the
// abbreviation below is the conventional one, chosen here to fit the panel.
export const SHORT = {
  lv: 'LV', rv: 'RV', la: 'LA', ra: 'RA', ivs: 'IVS', ias: 'IAS',
  mv: 'MV', tv: 'TV', av: 'AoV', pv: 'PV', aorta: 'Ao', mpa: 'MPA',
  lpa: 'LPA', rpa: 'RPA', pda: 'PDA', svc: 'SVC', ivc: 'IVC',
  hepatic_v: 'Hep V', celiac: 'Coeliac', sma: 'SMA',
  innominate: 'BCA', lcca: 'LCCA', lsca: 'LSCA',
  lupv: 'LUPV', llpv: 'LLPV', rupv: 'RUPV', rlpv: 'RLPV',
  pap_al: 'AL pap', pap_pm: 'PM pap', lvot: 'LVOT', rvot: 'RVOT',
  liver: 'Liver', spine: 'Spine',
};
