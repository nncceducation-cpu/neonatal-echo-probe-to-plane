// scene3d.js - the 3-D panel: torso, heart, probe, and the imaging plane.
//
// The cut surface is filled from the SAME contour loops the 2-D sector uses, so
// a cut chamber reads as solid myocardium with an open blood pool rather than
// as a hollow shell - the defect that makes naive GPU clipping look wrong.

import * as THREE from './vendor/three.module.js';
import { OrbitControls } from './vendor/controls/OrbitControls.js';
import { PAINT_ORDER } from './sector.js';
import { torsoSurface } from './body.js';

const COLOR = {
  myocardium: 0xb2534f, blood: 0x1b2433, valve: 0xf0e6d2,
  vessel: 0xc0655f, organ: 0x8d6f5a, bone: 0xded9cf,
};
const CUT_COLOR = {
  myocardium: 0xd97a72, blood: 0x0d1420, valve: 0xfff6e6,
  vessel: 0xe08a82, organ: 0xa2856d, bone: 0xf2eee6,
};

function buildTorso() {
  const nv = 64, nu = 72, y0 = 2.4, y1 = -8.6;
  const pos = [], idx = [];
  for (let j = 0; j <= nv; j++) {
    const y = y0 + (y1 - y0) * (j / nv);
    const { a, c, zc } = torsoSurface(y);
    for (let i = 0; i <= nu; i++) {
      const t = (i / nu) * Math.PI * 2;
      pos.push(a * Math.cos(t), y, zc + c * Math.sin(t));
    }
  }
  const row = nu + 1;
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const p = j * row + i;
      idx.push(p, p + row, p + 1, p + row, p + row + 1, p + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return new THREE.Mesh(g, new THREE.MeshStandardMaterial({
    color: 0xf0cdb4, transparent: true, opacity: 0.12, roughness: 0.9,
    side: THREE.DoubleSide, depthWrite: false,
  }));
}

export class Scene3D {
  constructor(canvas, anatomy, structures) {
    this.anatomy = anatomy;
    this.structures = structures;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0e14);

    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200);
    this.camera.position.set(11, 4, 13);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(0.6, -3.1, -0.9);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;

    this.scene.add(new THREE.HemisphereLight(0xdfeaff, 0x20160f, 0.85));
    const key = new THREE.DirectionalLight(0xffffff, 1.5);
    key.position.set(7, 9, 12);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x7fa8ff, 0.5);
    rim.position.set(-8, -3, -9);
    this.scene.add(rim);

    this.torso = buildTorso();
    this.scene.add(this.torso);

    // heart meshes, one per structure part, with clipping planes attached
    this.clip = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    this.renderer.localClippingEnabled = true;
    this.bodies = new THREE.Group();
    this.meshes = new Map();
    for (const [id, s] of structures) {
      const grp = new THREE.Group();
      grp.userData.id = id;
      for (const part of s.parts) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position',
          new THREE.BufferAttribute(part.tris.pos.slice(), 3));
        g.setIndex(new THREE.BufferAttribute(part.tris.idx.slice(), 1));
        g.computeVertexNormals();
        const isCav = part.role === 'cavity';
        const m = new THREE.MeshStandardMaterial({
          color: isCav ? COLOR.blood : (COLOR[s.tissue] || COLOR.myocardium),
          roughness: 0.62, metalness: 0.02,
          side: THREE.DoubleSide,
          transparent: s.group === 'context',
          opacity: s.group === 'context' ? 0.22 : 1.0,
          clippingPlanes: [this.clip], clipShadows: true,
        });
        const mesh = new THREE.Mesh(g, m);
        mesh.userData = { id, role: part.role, tissue: s.tissue };
        mesh.renderOrder = PAINT_ORDER.indexOf(id) + (isCav ? 100 : 0);
        grp.add(mesh);
      }
      this.meshes.set(id, grp);
      this.bodies.add(grp);
    }
    this.scene.add(this.bodies);

    this.caps = new THREE.Group();
    this.scene.add(this.caps);
    this.overlay = new THREE.Group();
    this.scene.add(this.overlay);
    this.probe = this._buildProbe();
    this.scene.add(this.probe);
    this._buildLandmarks();
    this.showCut = true;
  }

  _buildProbe() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.30, 0.34, 1.5, 24),
      new THREE.MeshStandardMaterial({ color: 0xe9ecf2, roughness: 0.45 }));
    body.position.y = 0.95;
    const face = new THREE.Mesh(
      new THREE.CylinderGeometry(0.30, 0.26, 0.18, 24),
      new THREE.MeshStandardMaterial({ color: 0x2b3340, roughness: 0.3 }));
    face.position.y = 0.09;
    // the index mark: the ridge on one side of the transducer
    const mark = new THREE.Mesh(
      new THREE.BoxGeometry(0.075, 0.9, 0.075),
      new THREE.MeshStandardMaterial({ color: 0xffc83d, roughness: 0.4 }));
    mark.position.set(0.30, 0.62, 0);
    const cable = new THREE.Mesh(
      new THREE.CylinderGeometry(0.09, 0.09, 0.8, 12),
      new THREE.MeshStandardMaterial({ color: 0x9aa3b2, roughness: 0.6 }));
    cable.position.y = 2.05;
    g.add(body, face, mark, cable);
    g.userData.mark = mark;
    return g;
  }

  _buildLandmarks() {
    const lm = this.anatomy.landmarks;
    const grp = new THREE.Group();
    for (const key of Object.keys(this.anatomy.window_labels || {})) {
      const p = lm[key];
      if (!p) continue;
      const d = new THREE.Mesh(
        new THREE.SphereGeometry(0.13, 16, 12),
        new THREE.MeshStandardMaterial({ color: 0x59d1ff, roughness: 0.4 }));
      d.position.set(p[0], p[1], p[2]);
      d.userData.window = key;
      grp.add(d);
    }
    this.windowDots = grp;
    this.scene.add(grp);
  }

  /** Seat the probe at the contact point, pointing along the beam. */
  setProbe(contact, beam, index) {
    const c = new THREE.Vector3(...contact);
    const b = new THREE.Vector3(...beam).normalize();
    const i = new THREE.Vector3(...index).normalize();
    // local +Y of the probe model points back out of the body
    const up = b.clone().negate();
    const m = new THREE.Matrix4();
    const zAxis = new THREE.Vector3().crossVectors(i, up).normalize();
    m.makeBasis(i, up, zAxis);
    this.probe.position.copy(c);
    this.probe.quaternion.setFromRotationMatrix(m);
  }

  /**
   * Show the imaging plane: clip the anatomy on the near side of it and fill
   * the cut face from the contour loops.
   */
  setPlane(plane, slices, view) {
    const n = new THREE.Vector3(...plane.n).normalize();
    const o = new THREE.Vector3(...plane.origin);
    // keep the half-space on the far side of the plane from the camera-facing
    // side, so the cut face is what you look at
    this.clip.setFromNormalAndCoplanarPoint(n, o);
    const enable = this.showCut;
    this.bodies.traverse((m) => {
      if (m.material) m.material.clippingPlanes = enable ? [this.clip] : [];
    });

    // fill the cut face
    this.caps.clear();
    if (enable) {
      const u = new THREE.Vector3(...plane.u);
      const v = new THREE.Vector3(...plane.v);
      const byId = new Map(slices.map((r) => [r.id, r]));
      const order = PAINT_ORDER.filter((id) => byId.has(id));
      order.forEach((id, k) => {
        const r = byId.get(id);
        const mk = (loops, colour) => {
          for (const loop of loops) {
            if (loop.length < 3) continue;
            const pts2 = loop.map((p) => new THREE.Vector2(p[0], p[1]));
            let tri;
            try { tri = THREE.ShapeUtils.triangulateShape(pts2, []); }
            catch (e) { continue; }
            const pos = [];
            const eps = 0.004 * (k + 1);       // lift later caps to win z-fight
            for (const t of tri) {
              for (const ix of t) {
                const p = pts2[ix];
                const w = o.clone()
                  .addScaledVector(u, p.x)
                  .addScaledVector(v, p.y)
                  .addScaledVector(n, eps);
                pos.push(w.x, w.y, w.z);
              }
            }
            if (!pos.length) continue;
            const g = new THREE.BufferGeometry();
            g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
            g.computeVertexNormals();
            this.caps.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({
              color: colour, roughness: 0.75, side: THREE.DoubleSide,
            })));
          }
        };
        mk(r.outer, CUT_COLOR[r.tissue] || CUT_COLOR.myocardium);
        mk(r.cavity, CUT_COLOR.blood);
      });
    }

    // the sector wedge, drawn as a translucent fan on the imaging plane
    this.overlay.clear();
    const half = (view.sector * Math.PI) / 360;
    const u = new THREE.Vector3(...plane.u);
    const v = new THREE.Vector3(...plane.v);
    const pts = [o.clone()];
    for (let k = 0; k <= 28; k++) {
      const a = -half + (2 * half * k) / 28;
      pts.push(o.clone()
        .addScaledVector(v, Math.cos(a) * view.depth)
        .addScaledVector(u, Math.sin(a) * view.depth));
    }
    const fan = [];
    for (let k = 1; k < pts.length - 1; k++) {
      fan.push(pts[0], pts[k], pts[k + 1]);
    }
    const fg = new THREE.BufferGeometry().setFromPoints(fan);
    this.overlay.add(new THREE.Mesh(fg, new THREE.MeshBasicMaterial({
      color: 0x4fb0ff, transparent: true, opacity: 0.14,
      side: THREE.DoubleSide, depthWrite: false,
    })));
    const eg = new THREE.BufferGeometry().setFromPoints(
      pts.slice(1).concat([pts[0], pts[1]]));
    this.overlay.add(new THREE.Line(eg, new THREE.LineBasicMaterial({
      color: 0x7fc8ff, transparent: true, opacity: 0.6,
    })));
    // the beam axis
    const bg = new THREE.BufferGeometry().setFromPoints(
      [o.clone(), o.clone().addScaledVector(v, view.depth)]);
    this.overlay.add(new THREE.Line(bg, new THREE.LineDashedMaterial({
      color: 0xffd24a, dashSize: 0.22, gapSize: 0.16,
    })).computeLineDistances());
  }

  /** The heart's own long axis, drawn as the reference every section is built on. */
  setAxisVisible(on) {
    if (!this._axis) {
      const h = this.anatomy.heart;
      const a = new THREE.Vector3(...h.apex);
      const b = new THREE.Vector3(...h.base);
      const dir = b.clone().sub(a).normalize();
      const g = new THREE.BufferGeometry().setFromPoints([
        a.clone().addScaledVector(dir, -0.9),
        b.clone().addScaledVector(dir, 1.5)]);
      this._axis = new THREE.Line(g, new THREE.LineBasicMaterial({
        color: 0x5ef2b0, transparent: true, opacity: 0.9 }));
      this.scene.add(this._axis);
    }
    this._axis.visible = on;
  }

  setVisibleGroups(groups) {
    for (const [id, grp] of this.meshes) {
      const s = this.structures.get(id);
      grp.visible = groups.has(s.group);
    }
  }

  resize(w, h) {
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  render() {
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}
