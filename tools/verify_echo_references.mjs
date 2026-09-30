import assert from 'node:assert/strict';
import fs from 'node:fs';
import { echoReferences, referenceMatches } from '../js/echo-references.js';
import { Probe } from '../js/probe.js';
const {views} = JSON.parse(fs.readFileSync(new URL('../data/views.json',import.meta.url)));
for (const [id,ref] of Object.entries(echoReferences)) {
  const v=views.find(v=>v.id===id);assert.ok(v,id);
  const p=new Probe(v);assert.ok(referenceMatches(p,v));
  p.sweep(5);assert.equal(referenceMatches(p,v),false);
  p.load(v).rotate(5);assert.equal(referenceMatches(p,v),false);
  assert.ok(fs.statSync(new URL('../assets/echo-studies/'+ref.file,import.meta.url)).size>10000);
  if(ref.dopplerFile) assert.ok(fs.statSync(new URL('../assets/echo-studies/'+ref.dopplerFile,import.meta.url)).size>10000);
}
assert.equal(echoReferences.psax_apical,undefined);
assert.notEqual(echoReferences.psax_mv.file,echoReferences.psax_pap.file);
assert.ok(echoReferences.sub_long.dopplerFile);
assert.ok(echoReferences.plax_rv_out.dopplerFile);
console.log('SCAN clips and Doppler pairs exist; short-axis levels are distinct; off-plane matching passes.');
