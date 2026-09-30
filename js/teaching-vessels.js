// Connected great-vessel teaching reconstruction. Dimensions are illustrative,
// not a patient reconstruction. The native atlas has neither arch branches nor
// a ductus and its rigid cardiac-axis rotation displaces the arch above the
// suprasternal window. Anchor the replacement to the existing valve roots.
// Both panels intersect these SAME 3-D surfaces, including the lumen surfaces.
import {tube,catmullRom,add,sub,mul,dot,cross,unit} from './geom.js?v=20260929-9';
import {skinAt} from './body.js?v=20260929-9';

export function teachingVessels(heart) {
  const geometries={},paths={},structures=[];
  const vessel=(id,label,path,radius,taper=path.map(()=>1),blood=2)=>{
    // Equal-distance knots prevent a tiny terminal arch step followed by a
    // long descending segment from folding the Catmull-Rom tube back on itself.
    const length=[0];for(let i=1;i<path.length;i++)length.push(length.at(-1)+Math.hypot(...sub(path[i],path[i-1])));
    const uniform=[],radii=[];
    for(let i=0;i<=96;i++) {
      const d=length.at(-1)*i/96;let k=1;while(k<length.length-1&&length[k]<d)k++;
      const t=(d-length[k-1])/(length[k]-length[k-1]);
      uniform.push(add(mul(path[k-1],1-t),mul(path[k],t)));
      radii.push(taper[k-1]*(1-t)+taper[k]*t);
    }
    const outer=tube(uniform,radius,radii,192,32);
    const inner=tube(uniform,radius,radii.map(t=>t-.055/radius),192,32);
    geometries[id]={positions:outer.pos,indices:outer.idx,
      lumen:{positions:inner.pos,indices:inner.idx},network:true,blood};
    paths[id]=path;
    structures.push({id,label,group:'vessel'});
  };
  const root=heart.aortic_root,ssn=skinAt(1.05,1.15);
  const ascending=add(root.centre,mul(root.axis,.65));
  const posterior=[1.40,-1.55,-4.08];
  const archN=unit(cross(sub(ascending,ssn),sub(posterior,ssn)));
  const onArch=(y,z)=>[ssn[0]-(archN[1]*(y-ssn[1])+archN[2]*(z-ssn[2]))/archN[0],y,z];
  const archBeam=unit(sub(mul(add(ascending,posterior),.5),ssn));
  let archU=unit(cross(archN,archBeam));
  if(dot(sub(posterior,ascending),archU)<0)archU=mul(archU,-1);
  const project=p=>sub(p,mul(archN,dot(sub(p,ssn),archN)));
  const archPath=[ascending,onArch(-.10,-1.95),onArch(.04,-2.75),
    onArch(-.28,-3.65),onArch(-.93,-4.08),posterior];
  const archSamples=Array.from({length:81},(_,i)=>catmullRom(archPath,i/80));
  // Aortic segments overlap at their shared centreline; lumen union removes
  // internal end walls at segment and branch junctions.
  vessel('aorta_asc','Ascending aorta',[add(root.centre,mul(root.axis,-.16)),root.centre,
    add(root.centre,mul(root.axis,.35)),...archSamples.slice(0,12)],root.radius+.055,
    [1,1,.94,...archSamples.slice(0,12).map((_,i)=>.90-i*.009)]);
  vessel('arch','Transverse aortic arch',archSamples.slice(7),.47,archSamples.slice(7).map((_,i)=>1-i*.0014));
  vessel('aorta_desc','Descending aorta',[...archSamples.slice(64),
    add(posterior,[0,-1.1,0]),[1.35,-4.4,-4.3],[1.3,-6.9,-4.5]],.42);
  for(const [id,label,t,rise,side,radius] of [
    ['innominate','Brachiocephalic artery',.29,.95,-.24,.17],
    ['lcca','Left common carotid artery',.46,1.08,0,.13],
    ['lsca','Left subclavian artery',.63,.85,.32,.15],
  ]) {
    const start=catmullRom(archPath,t);
    const away=unit(sub(start,mul(add(ascending,posterior),.5)));
    vessel(id,label,[start,add(start,mul(away,.46)),
      add(start,add(mul(away,rise),mul(archU,side*.25)))],radius);
  }

  // The duct inserts on proximal descending Ao, distal to the left subclavian
  // origin. It is NOT a continuation of the transverse arch or of the LPA.
  const ductAo=catmullRom(archPath,.86),pv=heart.valves.pv;
  const ductContact=skinAt(2.45,-.65);
  const ductN=unit(cross([0,-1,0],sub(ductAo,ductContact)));
  const junction0=[2.10,-.95,-2.95];
  const junction=sub(junction0,mul(ductN,dot(sub(junction0,ductContact),ductN)));
  vessel('mpa','Main pulmonary artery',[add(pv,mul(unit(sub(junction,pv)),-.16)),pv,
    add(mul(pv,.55),mul(junction,.45)),junction],.48,[.83,.90,1,1],3);
  vessel('pda','Patent ductus arteriosus (teaching example)',[junction,
    add(mul(junction,.55),mul(ductAo,.45)),ductAo],.18,[1.20,1,.85],3);
  // Branches diverge in 3-D. They must not become a single false arch-shaped
  // pulmonary vessel. RPA runs posterior to the ascending aorta.
  const rpaMid=project([1.25,-1.05,-2.75]);
  vessel('rpa','Right pulmonary artery',[junction,rpaMid,add(rpaMid,[-1.4,-.15,0])],.25,[1.35,1,.8],3);
  vessel('lpa','Left pulmonary artery',[junction,add(junction,[.65,-.10,-.15]),
    add(junction,[1.5,-.35,-.45])],.27,[1.25,1,.8],3);
  const ductObliqueN=unit(cross(sub(paths.lpa[1],ductContact),sub(ductAo,ductContact)));
  return {geometries,structures,paths,
    presets:{ssn_arch:{contact:ssn,normal:archN,target:project([1.6,-.85,-2.9]),beam:unit(sub([0,-1,-.6],mul(archN,dot([0,-1,-.6],archN))))},
      high_ps_duct:{contact:ductContact,normal:ductN,target:mul(add(junction,ductAo),.5),beam:unit(sub([0,-1,-.65],mul(ductN,dot([0,-1,-.65],ductN))))},
      psax_pda:{contact:ductContact,normal:ductObliqueN,target:mul(add(junction,ductAo),.5)}},
    landmarks:{archSamples,ductAo,junction,rpaMid},
    focus:{ssn_arch:['aorta_asc','arch','aorta_desc','innominate','lcca','lsca','rpa'],
      high_ps_duct:['mpa','pda','lpa','arch','aorta_desc'],
      psax_pda:['mpa','pda','lpa','arch','aorta_desc']}};
}
