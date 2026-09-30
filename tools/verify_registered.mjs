import fs from 'node:fs';
import { RegisteredHeart } from '../js/registered-heart.js';
import { Probe } from '../js/probe.js';
import assert from 'node:assert/strict';

const readJson = path => JSON.parse(fs.readFileSync(path, 'utf8'));
const meta = readJson('data/heart_meta.json');
const frame = readJson('data/frame.json');
const meshBytes = fs.readFileSync('data/heart.bin');
const gridBytes = fs.readFileSync('data/chambers.bin');
const mesh = meshBytes.buffer.slice(meshBytes.byteOffset, meshBytes.byteOffset + meshBytes.byteLength);
const grid = gridBytes.buffer.slice(gridBytes.byteOffset, gridBytes.byteOffset + gridBytes.byteLength);
const head = new DataView(grid, 0, 28);
const origin = [0,4,8].map(i => head.getFloat32(i, true));
const step = head.getFloat32(12, true);
const dims = [16,20,24].map(i => head.getInt32(i, true));
const heart = new RegisteredHeart(meta, frame, mesh, origin, step, dims, new Uint8Array(grid, 28));
const views = readJson('data/views.json').views;
const av = heart.adaptView(views.find(v=>v.id === 'psax_av'));
const avNormal = [av.beam[1]*av.index[2]-av.beam[2]*av.index[1],av.beam[2]*av.index[0]-av.beam[0]*av.index[2],av.beam[0]*av.index[1]-av.beam[1]*av.index[0]];
const avPlane = {origin:av.contact,u:av.index,v:av.beam,n:avNormal};
if (!heart.aorticSectionVisible(avPlane)) throw Error('AV preset does not intersect the valve reconstruction');
if(!heart.valveSections(avPlane).some(s=>s.id==='av')) throw Error('Teaching aortic cusps must intersect the root plane');
if(!heart.reconstructedValves.av) throw Error('Do not restore the old atlas funnel');
const displaced = {...avPlane,origin:avPlane.origin.map((x,i)=>x+avNormal[i])};
if(heart.aorticSectionVisible(displaced)) throw Error('AV should disappear away from its basal level');
console.log('AV root targeting and explicit teaching cusp replacement — pass (not clinical validation)');
const cross = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const visible = view => {
  const v = heart.adaptView(view), n = cross(v.beam,v.index);
  if (!Number.isFinite(Math.hypot(...n))) throw Error(`Invalid pose: ${v.id}`);
  const found = new Set(), half = v.sector*Math.PI/360;
  for (let d=.1; d<=v.depth; d+=.06) for (let a=-half; a<=half; a+=.025) {
    const p = v.contact.map((x,i) => x+d*(v.beam[i]*Math.cos(a)+v.index[i]*Math.sin(a)));
    found.add(heart.sample(p));
  }
  return found;
};
const cases = {
  plax: [2,3], psax_mv: [2,3], psax_pap: [2,3], a4c: [2,3,4,5],
};
for (const [id, expected] of Object.entries(cases)) {
  const seen = visible(views.find(v => v.id === id));
  for (const code of expected) if (!seen.has(code)) throw Error(`${id} misses chamber code ${code}; got ${[...seen]}`);
  console.log(`${id}: ${[...seen].join(', ')} — pass`);
}
for(const original of views) {
  const v=heart.adaptView(original);
  heart.setVascularView(v.id);
  const probe=new Probe(v),contact=[...v.contact];
  probe.sweep(6).rotate(15).rock(-5).slide(10,10);
  assert.deepEqual(probe.contact,contact,`${v.id}: calibrated window drifted`);
  probe.load(v);
  assert.deepEqual(probe.contact,contact);
  const plane={origin:v.contact,u:v.index,v:v.beam,n:cross(v.beam,v.index)};
  const anchors={plax:['mv','av'],a3c:['mv','av'],sub_lvot:['mv','av'],a4c:['mv','tv'],sub_long:['mv','tv'],plax_rv_out:['pv'],sub_rvot:['pv']}[v.id]||[];
  for(const id of anchors) {
    const distance=heart.frame.heart.valves[id].reduce((s,x,i)=>s+(x-plane.origin[i])*plane.n[i],0);
    assert.ok(Math.abs(distance)<1e-8,`${v.id} misses ${id} valve centre`);
  }
  const sections=heart.valveSections(plane);
  if(v.id==='ssn_crab') {
    const found=new Set(heart.meshSections(plane).map(s=>s.id));
    for(const id of ['lupv','llpv','rupv','rlpv']) if(!found.has(id))throw Error(`Crab plane misses ${id}`);
  }
  if(v.id==='psax_mv') {
    const cosine=Math.abs(plane.n.reduce((s,x,i)=>s+x*heart.frame.heart.mitral_section.normal[i],0));
    assert.ok(cosine>.999999,'Skin-contact calibration must retain the fitted inflow plane');
    const offset=heart.frame.heart.mitral_section.centre.reduce((s,x,i)=>s+(x-plane.origin[i])*plane.n[i],0);
    assert.ok(Math.abs(offset)<1e-8,'MV preset changed its intended level');
    assert.ok(!heart.meshSections(plane).some(s=>s.id==='aorta_asc'),'MV level must not intersect the ascending aorta');
    assert.ok(!sections.some(s=>['av','pv','tv'].includes(s.id)),'MV level must not show basal valves');
    assert.equal(heart.meshSections(plane).filter(s=>s.id==='mv').length,2,'Both mitral leaflet components must intersect');
  }
  if(['psax_pap','psax_apical'].includes(v.id)&&sections.length)throw Error(`${v.id} incorrectly intersects a valve`);
  for(const section of sections) for(const segment of section.segments) {
    if(!segment.flat().every(Number.isFinite)) throw Error('Non-finite valve contour');
  }
  console.log(`${v.id} valve intersections: ${sections.map(s=>s.id).join(', ') || 'none'}`);
  const expected={plax:['mv'],plax_rv_in:['tv'],plax_rv_out:['pv'],a4c:['mv','tv'],a2c:['mv'],a3c:['mv'],sub_rvot:['pv'],psax_mv:['mv']}[v.id];
  if(expected) for(const id of expected) if(!sections.some(s=>s.id===id)) throw Error(`${v.id} missing ${id}`);
}
