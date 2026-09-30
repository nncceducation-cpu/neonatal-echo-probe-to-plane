import assert from 'node:assert/strict';
import fs from 'node:fs';
import {teachingValve} from '../js/teaching-valves.js';
import {RegisteredHeart} from '../js/registered-heart.js';
import {registerTeachingHeart} from '../js/teaching-registration.js';
const frame=JSON.parse(fs.readFileSync('data/frame.json'));
const registration=registerTeachingHeart({structures:[]},frame,new ArrayBuffer(0));
for(const point of [frame.heart.apex,frame.heart.base,...Object.values(frame.chamber_seeds)]) {
  const back=registration.toSource(registration.toTeaching(point));
  assert.ok(Math.hypot(...back.map((x,i)=>x-point[i]))<1e-10,'Grid and mesh registration must be inverse transforms');
}
for(const [id,count] of Object.entries({mv:2,tv:3,av:3,pv:3})) {
  const g=teachingValve(frame,id);
  assert.equal(g.components.length,count);
  assert.ok([...g.positions].every(Number.isFinite));
  for(const part of g.components) {
    const edges=new Map();
    for(let i=part.firstIndex;i<part.firstIndex+part.indexCount;i+=3) {
      const ids=[...g.indices.slice(i,i+3)];
      for(let j=0;j<3;j++) {
        const a=ids[j],b=ids[(j+1)%3],key=[Math.min(a,b),Math.max(a,b)].join(':');
        edges.set(key,(edges.get(key)||0)+1);
      }
    }
    assert.ok([...edges.values()].every(n=>n===2),`${id}: open leaflet mesh`);
  }
}
const heart=Object.create(RegisteredHeart.prototype);
heart.sample=()=>1;
const artery={id:'mpa',group:'vessel',crossings:[0,1]};
assert.equal(heart.sampleSection([],0.5,[],[artery]),3);
assert.equal(heart.sampleSection([],0.01,[],[artery]),0);
assert.equal(heart.sampleSection([],2,[],[artery]),1);
assert.equal(heart.sampleSection([],.5,[0,1],[artery]),0,'Vessel overlap must not punch through myocardium');
const valve={group:'valve',label:6,crossings:[.4,.6]};
assert.equal(heart.sampleSection([],.5,[],[artery,valve]),6);
assert.equal(heart.sampleSection([],.5,[],[valve,valve]),6,'Overlapping leaflets form a union, not an XOR');
console.log('Closed leaflet components, vessel lumen/wall distinction and valve priority pass. These are engineering checks, not clinical validation.');
