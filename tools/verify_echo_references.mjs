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
}
assert.equal(echoReferences.psax_apical,undefined);
assert.equal(echoReferences.sub_long,undefined);
assert.equal(echoReferences.ssn_arch,undefined);
console.log('5 local clips exist; off-plane matching and no unrelated fallback tests passed.');
