// Draft atlas-to-chest registration. This orientation is an authored teaching
// assumption, not a measurement from the independent clinical clips.
export function registerTeachingHeart(meta,sourceFrame,sourceMesh) {
  const frame=structuredClone(sourceFrame),mesh=sourceMesh.slice(0);
  const add=(a,b)=>a.map((x,i)=>x+b[i]),sub=(a,b)=>a.map((x,i)=>x-b[i]);
  const mul=(a,s)=>a.map(x=>x*s),dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0);
  const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const unit=a=>mul(a,1/Math.hypot(...a));
  const from=unit(frame.heart.long_axis),to=unit([-.65,.68,-.35]);
  const pivot=mul(add(frame.heart.apex,frame.heart.base),.5);
  const axis=unit(cross(from,to)),cos=dot(from,to),sin=Math.sqrt(1-cos*cos);
  const rotate=(p,inverse=false)=>add(add(mul(p,cos),mul(cross(axis,p),inverse?-sin:sin)),mul(axis,dot(axis,p)*(1-cos)));
  const shift=[0,0,0];
  const point=p=>add(shift,add(pivot,rotate(sub(p,pivot))));
  for(const s of meta.structures) {
    const positions=new Float32Array(mesh,s.vByte,s.vCount*3);
    for(let i=0;i<positions.length;i+=3) positions.set(point([...positions.slice(i,i+3)]),i);
  }
  const myocardium=meta.structures.find(s=>s.id==='myo');
  if(myocardium) {
    const p=new Float32Array(mesh,myocardium.vByte,myocardium.vCount*3);
    let anterior=-Infinity;
    for(let i=2;i<p.length;i+=3)anterior=Math.max(anterior,p[i]);
    // Keep the rotated myocardium behind the anterior chest, not protruding
    // through the transducer. Preserve dimensions and all relative anatomy.
    shift[2]=Math.min(0,-.35-anterior);
    for(const s of meta.structures) {
      const vertices=new Float32Array(mesh,s.vByte,s.vCount*3);
      for(let i=2;i<vertices.length;i+=3)vertices[i]+=shift[2];
    }
  }
  const h=frame.heart;
  h.apex=point(h.apex);h.base=point(h.base);h.long_axis=rotate(h.long_axis);
  for(const key of Object.keys(h.valves))h.valves[key]=point(h.valves[key]);
  for(const key of Object.keys(h.basis))h.basis[key]=rotate(h.basis[key]);
  h.aortic_root.centre=point(h.aortic_root.centre);
  h.aortic_root.axis=rotate(h.aortic_root.axis);
  for(const key of Object.keys(frame.chamber_seeds))frame.chamber_seeds[key]=point(frame.chamber_seeds[key]);
  const columns=[[1,0,0],[0,1,0],[0,0,1]].map(p=>rotate(p,true));
  const toSource=p=>{
    const x=p[0]-pivot[0]-shift[0],y=p[1]-pivot[1]-shift[1],z=p[2]-pivot[2]-shift[2];
    return [pivot[0]+columns[0][0]*x+columns[1][0]*y+columns[2][0]*z,
      pivot[1]+columns[0][1]*x+columns[1][1]*y+columns[2][1]*z,
      pivot[2]+columns[0][2]*x+columns[1][2]*y+columns[2][2]*z];
  };
  return {frame,mesh,toSource,toTeaching:point};
}
