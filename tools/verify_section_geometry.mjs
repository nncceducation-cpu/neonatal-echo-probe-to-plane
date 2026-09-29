import assert from 'node:assert/strict';
import {RegisteredHeart} from '../js/registered-heart.js';
import {Probe} from '../js/probe.js';
// An exact square cross-section provides a known boundary independent of the
// clinical atlas or its coarse labels.
const heart=Object.create(RegisteredHeart.prototype);
heart.meshSections=()=>[{id:'myo',segments:[[[0,0],[2,0]],[[2,0],[2,2]],[[2,2],[0,2]],[[0,2],[0,0]]]}];
heart.sample=()=>0;
const crossings=heart.wallIntervals({},1);
assert.deepEqual(crossings,[0,2]);
assert.equal(heart.sampleSection([0,0,0],1,crossings),0);
assert.equal(heart.sampleSection([0,0,0],3,crossings),1);
heart.sample=()=>2;
assert.equal(heart.sampleSection([0,0,0],3,crossings),2);
assert.equal(heart.sampleSection([0,0,0],3,crossings,[{label:6,crossings:[2.9,3.1]}]),6);
assert.equal(heart.sampleSection([0,0,0],3.2,crossings,[{label:6,crossings:[2.9,3.1]}]),2);
const probe=new Probe({id:'test',contact:[0,0,0],beam:[0,0,1],index:[1,0,.05],depth:12,sector:90});
const plane=probe.plane();
assert.ok(Math.abs(plane.u.reduce((s,x,i)=>s+x*plane.v[i],0))<1e-12);
console.log('Exact wall boundary, coarse-wall exclusion, chamber labels and orthogonal slice frame pass');
