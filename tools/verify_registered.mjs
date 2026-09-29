import fs from 'node:fs';
import { RegisteredHeart } from '../js/registered-heart.js';

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
let cusps=0;
const context = {save(){},restore(){},beginPath(){},moveTo(){},lineTo(){},quadraticCurveTo(){},closePath(){},fill(){cusps++},stroke(){}};
heart.drawAorticSection(context,avPlane,(x,y)=>[x,y]);
if(cusps!==3) throw Error('Expected three cusp surfaces');
const displaced = {...avPlane,origin:avPlane.origin.map((x,i)=>x+avNormal[i])};
if(heart.aorticSectionVisible(displaced)) throw Error('AV should disappear away from its basal level');
console.log('AV root intersection, three cusps and off-level exclusion — pass');
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
