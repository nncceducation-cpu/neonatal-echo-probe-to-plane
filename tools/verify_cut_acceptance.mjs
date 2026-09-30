import assert from 'node:assert/strict';
import {heart,views} from './section-audit.mjs';
import {Probe} from '../js/probe.js';
import {closedContours} from '../js/section-contours.js';
import {sectionTissueClass} from '../js/sector.js';
import {skinAt} from '../js/body.js';

const square=[[[0,0],[2,0]],[[2,0],[2,2]],[[2,2],[0,2]],[[0,2],[0,0]]];
assert.equal(closedContours(square)[0].area,4);
assert.deepEqual(closedContours(square)[0].centre,[1,1]);
assert.equal(closedContours(square.slice(0,3)).length,0,'Never close a missing wall artificially');
assert.equal(sectionTissueClass(2),sectionTissueClass(4),'LV/LA label seam is not tissue');
assert.equal(sectionTissueClass(3),sectionTissueClass(5),'RV/RA label seam is not tissue');
assert.notEqual(sectionTissueClass(0),sectionTissueClass(2));
assert.notEqual(sectionTissueClass(6),sectionTissueClass(2));

const plane=id=>new Probe(heart.adaptView(views.find(v=>v.id===id))).plane();
for(const id of ['psax_mv','psax_pap','psax_av','plax','a2c','a3c','a4c','sub_long']) {
  const v=heart.adaptView(views.find(v=>v.id===id)),skin=skinAt(v.contact[0],v.contact[1]);
  assert.ok(Math.hypot(...v.contact.map((x,i)=>x-skin[i]))<1e-8,`${id} probe must contact skin`);
}
const mv=plane('psax_mv'),sections=heart.meshSections(mv);
assert.ok(!sections.some(s=>s.id==='aorta_asc'),'No ascending aorta at MV level');
const cavities=closedContours(sections.find(s=>s.id==='myo').segments);
const cavity=cavities.find(c=>{
  const point=mv.origin.map((x,i)=>x+c.centre[0]*mv.u[i]+c.centre[1]*mv.v[i]);
  return [2,4].includes(heart.sample(point))&&c.area>1;
});
assert.ok(cavity,'LV cavity must have a real closed myocardial contour');
const xs=cavity.points.map(p=>p[0]),ys=cavity.points.map(p=>p[1]);
const w=Math.max(...xs)-Math.min(...xs),h=Math.max(...ys)-Math.min(...ys);
assert.ok(Math.max(w/h,h/w)<1.8,'MV cavity must not become an elongated LVOT section');
assert.equal(sections.filter(s=>s.id==='mv').length,2);

const pap=heart.meshSections(plane('psax_pap'));
for(const id of ['pap_al','pap_pm'])assert.ok(pap.some(s=>s.id===id),`Papillary level misses ${id}`);
assert.ok(!pap.some(s=>s.group==='valve'),'Papillary level cannot substitute a valve level');

const a2=plane('a2c'),counts={};
for(let d=.15;d<9;d+=.045){
  // Count chamber labels, not separate artery/caval lumens that share the
  // same red/blue palette but are not ventricular/atrial cavities.
  const wall=heart.wallIntervals(a2,d),tissue=heart.tissueIntervals(a2,d).filter(t=>t.group!=='vessel');
  for(let x=-4;x<4;x+=.045){
    const point=a2.origin.map((z,i)=>z+x*a2.u[i]+d*a2.v[i]);
    const code=heart.sampleSection(point,x,wall,tissue);
    counts[code]=(counts[code]||0)+1;
  }
}
assert.ok((counts[2]||0)>300&&(counts[4]||0)>100,'A2 must include LV and LA');
assert.ok(((counts[3]||0)+(counts[5]||0))/((counts[2]||0)+(counts[4]||0))<.03,'A2 must not retain a substantial RV/RA section');
const av=heart.meshSections(plane('psax_av'));
assert.equal(av.filter(s=>s.id==='av').length,3,'Three aortic cusp components');
assert.ok(av.some(s=>s.id==='pv')&&av.some(s=>s.id==='mpa'),'Basal SAX includes pulmonary outflow');
console.log('Focused geometry regressions pass: true closed MV-level LV, no aorta/basal valves, both papillary heads, LV/LA-only A2, AV/PV basal plane, no false blood-label seams. Not clinical sign-off.');
