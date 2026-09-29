import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Probe } from '../js/probe.js';
const { views } = JSON.parse(fs.readFileSync(new URL('../data/views.json', import.meta.url)));
for (const view of views) {
  const p = new Probe(view), contact = [...p.contact], normal = [...p.plane().n];
  p.slide(10,10).sweep(6);
  assert.deepEqual(p.contact, contact, `${view.id}: contact drift`);
  assert.notDeepEqual(p.plane().n, normal, `${view.id}: sweep must change plane`);
  p.rotate(15).rock(-5);
  assert.deepEqual(p.contact, contact);
  assert.ok(Math.abs(Math.hypot(...p.beam)-1)<1e-9);
  p.load(view);
  assert.deepEqual(p.contact,view.contact);
}
console.log(`${views.length} windows: locked contact, pivoting sweep, rotation, rock and reset passed.`);
