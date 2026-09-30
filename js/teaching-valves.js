// Instructor-guided, static open-leaflet reconstruction. Not patient-derived.
// Closed thin surfaces allow identical tissue intersections in 3D and 2D.
export function teachingValve(frame,id) {
  const add=(a,b)=>a.map((x,i)=>x+b[i]), sub=(a,b)=>a.map((x,i)=>x-b[i]);
  const mul=(a,s)=>a.map(x=>x*s),dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0);
  const unit=a=>mul(a,1/Math.hypot(...a));
  const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const fitted=frame.heart.valve_geometry?.[id];
  const centre=fitted?.centre || frame.heart.valves[id];
  const semilunar=id==='av'||id==='pv';
  const axis=fitted?.axis || (semilunar ? (id==='av'?frame.heart.aortic_root.axis:unit(sub(centre,frame.chamber_seeds.rv))) : unit(sub(frame.chamber_seeds[id==='mv'?'lv':'rv'],centre)));
  const anterior=semilunar?[1,0,0]:sub(frame.heart.valves.av,centre);
  const v=unit(sub(anterior,mul(axis,dot(anterior,axis)))),u=unit(cross(v,axis));
  const rx=fitted?.rx || (semilunar?(id==='av'?frame.heart.aortic_root.radius:.43):(id==='mv'?1.05:.90)), ry=fitted?.ry || (semilunar?rx:(id==='mv'?.80:.70));
  const positions=[],indices=[],components=[],A=48,R=8;
  const leaflets=semilunar||id==='tv'?3:2;
  for(let leaflet=0;leaflet<leaflets;leaflet++) {
    const firstIndex=indices.length;
    const offset=positions.length/3, stride=R+1, count=(A+1)*stride;
    for(let side=0;side<2;side++) for(let a=0;a<=A;a++) for(let r=0;r<=R;r++) {
      const theta=(leaflet+a/A)*2*Math.PI/leaflets,t=r/R,s=Math.sin(theta);
      let x,y,z;
      if(semilunar) {
        // Three separate closed cusps, each attached to one third of the root.
        // The diastolic coaptation edges meet centrally; no 2D valve symbol.
        x=rx*Math.cos(theta)*(1-t); y=ry*s*(1-t);
        // A cusp is a pocket, not an almost-flat disk. Scale its belly with
        // the root so an en-face section resolves three coaptation seams
        // instead of intersecting broad opaque triangular wedges.
        const belly=id==='av'?rx*.55:.10,thickness=id==='av'?.012:.025;
        z=-belly*Math.sin(a/A*Math.PI)*(1-t)+(side?1:-1)*thickness;
      } else if(id==='tv') {
        x=rx*Math.cos(theta)*(1-.45*t); y=ry*s*(1-.45*t);
        z=.40*Math.sin(a/A*Math.PI)*Math.sin(t*Math.PI/2)+(side?1:-1)*.025;
      } else {
        x=rx*Math.cos(theta)*(1-.10*t); y=ry*s*(1-.55*t);
        // Continuous commissures: their ventricular extent must not collapse
        // to zero. The old sin(theta) taper left two disconnected floating
        // arcs in a short-axis slice instead of an open fish-mouth orifice.
        const length=(fitted?.length || .42)+(leaflet===0?.16*Math.abs(s):0);
        z=length*Math.sin(t*Math.PI/2)+(side?1:-1)*.02;
      }
      positions.push(...add(centre,add(mul(u,x),add(mul(v,y),mul(axis,z)))));
    }
    const tri=(a,b,c)=>indices.push(offset+a,offset+b,offset+c);
    for(let side=0;side<2;side++) for(let a=0;a<A;a++) for(let r=0;r<R;r++) {
      const k=side*count+a*stride+r;
      if(side){tri(k,k+1,k+stride);tri(k+1,k+stride+1,k+stride)}
      else{tri(k,k+stride,k+1);tri(k+1,k+stride,k+stride+1)}
    }
    const edge=(a,b)=>{tri(a,b,a+count);tri(b,b+count,a+count)};
    for(let a=0;a<A;a++){edge(a*stride,(a+1)*stride);edge(a*stride+R,(a+1)*stride+R)}
    for(let r=0;r<R;r++){edge(r,r+1);edge(A*stride+r,A*stride+r+1)}
    components.push({firstIndex,indexCount:indices.length-firstIndex});
  }
  return {positions:new Float32Array(positions),indices:new Uint32Array(indices),components};
}
