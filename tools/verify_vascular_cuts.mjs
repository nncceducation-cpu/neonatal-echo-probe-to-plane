import assert from 'node:assert/strict';
import {heart,views} from './section-audit.mjs';
import {Probe} from '../js/probe.js';
import {skinAt} from '../js/body.js';
import {dot,sub} from '../js/geom.js';
const plane=id=>new Probe(heart.adaptView(views.find(v=>v.id===id))).plane();
const sample=(p,q)=>{
  const d=sub(q,p.origin),x=dot(d,p.u),y=dot(d,p.v);
  return heart.sampleSection(q,x,heart.wallIntervals(p,y),heart.tissueIntervals(p,y));
};
// Whole-heart presets retain the original registered vessel surfaces exactly.
for(const id of ['aorta_asc','arch','aorta_desc','mpa','lpa','rpa']) {
  const s=heart.meta.structures.find(s=>s.id===id);
  assert.deepEqual(heart.geometryFor(s).positions,new Float32Array(heart.mesh,s.vByte,s.vCount*3));
}
for(const id of ['ssn_arch','high_ps_duct','psax_pda']) {
  const p=plane(id);heart.setVascularView(id);
  assert.deepEqual(p.origin,skinAt(p.origin[0],p.origin[1]));
  assert.ok(heart.meshSections(p).every(s=>s.group==='vessel'),'Vessel-only field must not include misleading chamber fragments');
  for(const vessel of id==='ssn_arch'?['arch','innominate','lcca','lsca','rpa']:['mpa','pda','aorta_desc'])
    assert.ok(heart.meshSections(p).some(s=>s.id===vessel&&s.lumen),`${id} must intersect the actual ${vessel} lumen`);
  const fit=heart.fitSector(p,id);assert.ok(fit.depth>0&&fit.depth<12&&fit.sector<177);
}
heart.setVascularView('ssn_arch');
const arch=plane('ssn_arch');
for(const point of heart.vascular.landmarks.archSamples.slice(1,-1))
  assert.equal(sample(arch,point),2,'Continuous arch lumen, not disconnected circles');
heart.setVascularView('high_ps_duct');
const duct=plane('high_ps_duct'),path=heart.vascular.paths.pda;
assert.deepEqual(path[0],heart.vascular.paths.mpa.at(-1));
assert.deepEqual(path.at(-1),heart.vascular.landmarks.ductAo);
for(let i=1;i<40;i++) {
  const q=path[0].map((x,k)=>x*(1-i/40)+path.at(-1)[k]*i/40);
  assert.ok([2,3].includes(sample(duct,q)),'No false wall at the PA–ductus–Ao junction');
}
const p=new Probe(heart.adaptView(views.find(v=>v.id==='high_ps_duct')));
const before=JSON.stringify(heart.meshSections(p.plane()));p.sweep(8);
assert.notEqual(JSON.stringify(heart.meshSections(p.plane())),before,'Sweep must recut 3-D geometry');
heart.setVascularView('plax');
assert.ok(heart.meshSections(plane('plax')).some(s=>s.id==='myo'),'Switching back restores the whole-heart cut');
assert.ok(!heart.meshSections(plane('plax')).some(s=>s.id==='pda'),'No new vascular model leaking into other cuts');
console.log('Vascular engineering checks pass: connected lumens, three arch branches, physical duct insertion, skin contact, live sweep, and unchanged native vessels outside the three vascular views. Not clinical validation.');
