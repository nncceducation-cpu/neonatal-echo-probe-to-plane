import assert from 'node:assert/strict';
import fs from 'node:fs';
import { cutOrientation, echoReferences } from '../js/echo-references.js';
import { SectorView } from '../js/sector.js';

// These defaults were checked against the linked cine contact sheets. Playback
// and Doppler are deliberately not inputs: orientation must survive both toggles.
const reversed = new Set(['a4c','a5c','sub_long','sub_lvot','sub_rvot']);
for (const id of [...Object.keys(echoReferences), 'a2c','a3c','psax_pda','unknown']) {
  assert.deepEqual(cutOrientation(id), {flipX:id==='a5c', flipY:reversed.has(id)}, id);
  assert.deepEqual(cutOrientation(id,true), {flipX:id!=='a5c', flipY:reversed.has(id)}, id);
}
globalThis.window = {devicePixelRatio:1};
const calls=[];
const g={beginPath(){},closePath(){},moveTo(...p){calls.push(p)},lineTo(...p){calls.push(p)},arc(...p){calls.push(p)}};
const sector=new SectorView({width:800,height:600,getContext:()=>g});
for(const flipX of [false,true])for(const flipY of [false,true]) {
  sector.orientation={flipX,flipY};
  const f=sector._fit(6,90);
  assert.equal(Math.sign(f.xs),flipX?-1:1);
  assert.equal(Math.sign(f.ys),flipY?-1:1);
  assert.equal(f.oy,flipY?562:52);
  calls.length=0;
  sector._path([[1,2],[-1,4]],f);
  assert.deepEqual(calls,[[f.ox+f.xs,f.oy+2*f.ys],[f.ox-f.xs,f.oy+4*f.ys]]);
  sector._sectorPath(6,90,f);
  assert.equal(calls.at(-1).at(-1),flipY,'fan arc follows depth');
  for(const d of [0,1,3,6])assert.ok(Math.abs(((f.oy+d*f.ys)-f.oy)/f.ys-d)<1e-10);
}
const app=fs.readFileSync(new URL('../js/app.js',import.meta.url),'utf8');

// Exercise the raster sampler and valve projector, not just contour paths.
// A physical point must reach the same screen side for tissue and leaflets.
globalThis.document={createElement:()=>({getContext:()=>({putImageData(){}})})};
let pixels, valvePoint;
const rasterContext={
  getImageData:()=>({data:new Uint8ClampedArray(800*600*4)}),
  save(){},restore(){},drawImage(buffer){},
};
const raster=new SectorView({width:800,height:600,getContext:()=>rasterContext});
raster.opts.speckle=false;
raster.imageBuffer={getContext:()=>({putImageData(img){pixels=img.data}})};
const plane={origin:[0,0,0],u:[1,0,0],v:[0,1,0]};
const volume={step:.01,wallIntervals:()=>[],tissueIntervals:()=>[],sample:()=>2,
  sampleSection:p=>Math.abs(p[0]-1)<.12&&Math.abs(p[1]-3)<.12?6:1,
  drawValveSections(g,p,project){valvePoint=project(1,3)}};
for(const flipX of [false,true])for(const flipY of [false,true]) {
  raster.orientation={flipX,flipY};
  const f=raster._fit(6,90);
  raster._drawRegistered(volume,plane,f,6,90);
  const [x,y]=valvePoint.map(Math.round);
  assert.ok(pixels[(y*800+x)*4]>0,'valve projection lands inside matching raster tissue');
  assert.equal(x>f.ox,!flipX);
  assert.equal(y>f.oy,!flipY);
}
assert.match(app,/state\.sector\.orientation = orientation/);
assert.match(app,/state\.scene\.sliceInvert = orientation\.flipX/);
assert.match(app,/state\.scene\.referenceReverseDepth = orientation\.flipY/);
assert.doesNotMatch(app,/referenceMode && !!ref\?\.reverseDepth/);
console.log('Clip orientation defaults, manual mirror, shared panels, fan and projection inverses pass.');
