// BodyParts3D-derived, neonatal-scale mesh and chamber labels.
// Both displays sample the same patient-frame data; this remains a teaching
// approximation, not a diagnostic reconstruction or ultrasound simulation.
import {teachingValve} from './teaching-valves.js?v=cuts-audit-5';
import {registerTeachingHeart} from './teaching-registration.js?v=cuts-review-1';
import {skinAt} from './body.js?v=20260929-9';
import {closedContours} from './section-contours.js?v=cuts-audit-4';
import {teachingVessels} from './teaching-vessels.js?v=arch-duct-2';
export class RegisteredHeart {
  static async load() {
    const [meta, frame, meshResponse, gridResponse] = await Promise.all([
      fetch('data/heart_meta.json').then(r => r.json()),
      fetch('data/frame.json').then(r => r.json()),
      fetch('data/heart.bin'), fetch('data/chambers.bin'),
    ]);
    if (!meshResponse.ok || !gridResponse.ok) throw new Error('Registered anatomy assets unavailable');
    const mesh = await meshResponse.arrayBuffer();
    const buffer = await gridResponse.arrayBuffer();
    const header = new DataView(buffer, 0, 28);
    const origin = [0, 4, 8].map(i => header.getFloat32(i, true));
    const step = header.getFloat32(12, true);
    const dims = [16, 20, 24].map(i => header.getInt32(i, true));
    const labels = new Uint8Array(buffer, 28);
    if (labels.length !== dims[0] * dims[1] * dims[2]) throw new Error('Invalid chamber grid');
    return new RegisteredHeart(meta, frame, mesh, origin, step, dims, labels);
  }

  constructor(meta, frame, mesh, origin, step, dims, labels) {
    Object.assign(this, { meta, frame, mesh, origin, step, dims, labels });
    const registered=registerTeachingHeart(meta,frame,mesh);
    this.frame=registered.frame;this.mesh=registered.mesh;this.toSource=registered.toSource;
    this.reconstructedValves={};
    this.calibrateAorticRoot();
    this.calibrateMitralInflow();
    this.reconstructedValves = Object.fromEntries(['mv','tv','av','pv'].map(id=>[id,teachingValve(this.frame,id)]));
    this.vascular=teachingVessels(this.frame.heart);
    const existing=new Set(this.meta.structures.map(s=>s.id));
    this.meta={...this.meta,structures:[...this.meta.structures,
      ...this.vascular.structures.filter(s=>!existing.has(s.id))]};
    this.valveCache=null;
  }

  calibrateAorticRoot() {
    // The imported root landmark was estimated from the lowest 4% of artery
    // vertices, inside a sealed taper. Fit the first complete root section,
    // rather than sizing/placing the three cusps on that artificial end cap.
    const h=this.frame.heart,root=h.aortic_root,n=root.axis;
    const u=[n[1],-n[0],0],length=Math.hypot(...u);u.forEach((x,i)=>u[i]=x/length);
    const v=[n[1]*u[2]-n[2]*u[1],n[2]*u[0]-n[0]*u[2],n[0]*u[1]-n[1]*u[0]];
    const candidates=[];
    for(let k=0;k<=7;k++) {
      const origin=root.centre.map((x,i)=>x+.1*k*n[i]);
      const section=this.meshSections({origin,n,u,v}).find(s=>s.id==='aorta_asc');
      const contour=section&&closedContours(section.segments)[0];
      if(contour)candidates.push({origin,...contour});
    }
    const maximum=Math.max(...candidates.map(c=>c.area));
    const ring=candidates.find(c=>c.area>=maximum*.95);
    if(ring) {
      root.centre=ring.origin.map((x,i)=>x+ring.centre[0]*u[i]+ring.centre[1]*v[i]);
      root.radius=Math.sqrt(ring.area/Math.PI)-.055;
      h.valves.av=[...root.centre];
    }
    this.valveCache=null;
  }

  calibrateMitralInflow() {
    // Atlas-specific teaching calibration, not a measured patient annulus.
    // The imported MV landmark is the centroid of leaflets AND chordae, not
    // an annulus. Treating it as a transverse annular plane mixed LV inflow
    // with LVOT. Fit a separate inflow frame and continue its sweep to the
    // papillary heads. Do not suppress any vessel by view ID.
    const h=this.frame.heart,delta=h.valves.av.map((x,i)=>x-h.valves.mv[i]);
    const axial=delta.reduce((s,x,i)=>s+x*h.long_axis[i],0);
    const transverse=delta.map((x,i)=>x-axial*h.long_axis[i]),length=Math.hypot(...transverse);
    const angle=20*Math.PI/180;
    const n=h.long_axis.map((x,i)=>x*Math.cos(angle)+transverse[i]/length*Math.sin(angle));
    const target=h.valves.mv.map((x,i)=>x-.65*n[i]);
    // Centre the inflow apparatus on the actual LV cavity at the leaflet-body
    // level, not on a whole-valve/chordal centroid displaced toward one wall.
    const u=[n[1],-n[0],0],ul=Math.hypot(...u);u.forEach((x,i)=>u[i]=x/ul);
    const v=[n[1]*u[2]-n[2]*u[1],n[2]*u[0]-n[0]*u[2],n[0]*u[1]-n[1]*u[0]];
    const plane={origin:target,n,u,v},N=81,step=.045,mask=new Uint8Array(N*N);
    for(let j=0;j<N;j++) {
      const y=(j-(N-1)/2)*step,wall=this.wallIntervals(plane,y);
      for(let i=0;i<N;i++) {
        const x=(i-(N-1)/2)*step,p=target.map((z,k)=>z+x*u[k]+y*v[k]);
        const label=this.sample(p);let count=0;for(const w of wall){if(w>x)break;count++;}
        if(count%2===0&&(label===2||label===4))mask[j*N+i]=1;
      }
    }
    let largest=[];
    for(let k=0;k<mask.length;k++)if(mask[k]) {
      const component=[k];mask[k]=0;
      for(let q=0;q<component.length;q++) {
        const at=component[q],x=at%N,y=Math.floor(at/N);
        for(const next of [x?at-1:-1,x<N-1?at+1:-1,y?at-N:-1,y<N-1?at+N:-1])
          if(next>=0&&mask[next]){mask[next]=0;component.push(next);}
      }
      if(component.length>largest.length)largest=component;
    }
    let centre=[...h.valves.mv];
    if(largest.length>150) {
      const x=largest.reduce((s,k)=>s+(k%N-(N-1)/2)*step,0)/largest.length;
      const y=largest.reduce((s,k)=>s+(Math.floor(k/N)-(N-1)/2)*step,0)/largest.length;
      centre=target.map((z,k)=>z+x*u[k]+y*v[k]+.65*n[k]);
    }
    h.valve_geometry={mv:{centre,axis:n.map(x=>-x),length:.85,rx:.9,ry:.7}};
    h.mitral_section={centre:target,normal:n};
    this.valveCache=null;
  }

  geometryFor(s) {
    if(this.vascularActive)return this.vascular.geometries[s.id]||{positions:new Float32Array(),indices:new Uint32Array()};
    return this.reconstructedValves[s.id] || (s.vByte===undefined?{positions:new Float32Array(),indices:new Uint32Array()}:
      {positions:new Float32Array(this.mesh,s.vByte,s.vCount*3),indices:new Uint32Array(this.mesh,s.iByte,s.iCount*3)});
  }

  setVascularView(id) {
    const active=!!this.vascular.presets[id];
    if(active!==!!this.vascularActive){this.vascularActive=active;this.valveCache=null;}
    return active;
  }

  adaptView(view) {
    const h = this.frame.heart, seeds = this.frame.chamber_seeds;
    const sub = (a,b) => a.map((x,i) => x-b[i]);
    const add = (a,b) => a.map((x,i) => x+b[i]);
    const mul = (a,s) => a.map(x => x*s);
    const dot = (a,b) => a.reduce((s,x,i) => s+x*b[i],0);
    const cross = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
    const unit = a => mul(a,1/Math.hypot(...a));
    let contact = [...view.contact];
    const id = view.id;
    let target, normal;
    const centroid = id => {
      const s=this.meta.structures.find(s=>s.id===id);
      if(!s) return null;
      const p=new Float32Array(this.mesh,s.vByte,s.vCount*3),c=[0,0,0];
      for(let i=0;i<p.length;i++)c[i%3]+=p[i]/(p.length/3);
      return c;
    };
    if(this.vascular.presets[id]) {
      ({contact,normal,target}=this.vascular.presets[id]);
    } else if (id.startsWith('psax_') && ['psax_av','psax_mv','psax_pap','psax_apical'].includes(id)) {
      const fraction = {psax_av:1,psax_mv:.77,psax_pap:.44,psax_apical:.18}[id];
      target = id === 'psax_av' ? h.valves.av : id === 'psax_mv' ? h.valves.mv
        : add(h.apex,mul(sub(h.base,h.apex),fraction));
      // Sample on the ventricular side through the leaflet bodies, rather
      // than at the annular attachment (which reads as a circular ring).
      if(id==='psax_mv') target=h.mitral_section.centre;
      if(id==='psax_pap') {
        // Cut both papillary heads, not the centroid of the full muscle
        // bodies (which merge into the ventricular wall farther apically).
        target=add(h.valves.mv,mul(h.mitral_section.normal,-1.3));
      }
      let axis = id === 'psax_av' ? h.aortic_root.axis : ['psax_mv','psax_pap'].includes(id) ? h.mitral_section.normal : h.long_axis;
      if(id==='psax_av') {
        // Keep the root nearly en-face, with a small sweep toward pulmonary
        // outflow. Forcing BOTH valve centroids into the plane made the Ao
        // cusps oblique. Surface intersection, not centroid equality, matters.
        const toPV=unit(sub(h.valves.pv,h.valves.av));
        axis=unit(sub(axis,mul(toPV,.25*dot(axis,toPV))));
      }
      // Calibrate the preset once on the anterior chest. Subsequent mouse
      // sweeps still pivot at this fixed contact; they never slide the probe.
      if(id!=='psax_apical') {
        contact=contactOnPlane(contact,target,axis,'parasternal');
        normal=axis;
      } else {
        if(Math.abs(axis[1])>.15) {
          const y=target[1]-(axis[0]*(contact[0]-target[0])+axis[2]*(contact[2]-target[2]))/axis[1];
          if(y>=-5.5 && y<=-.3) contact[1]=y;
        }
        const ray = unit(sub(target,contact));
        normal = unit(sub(axis,mul(ray,dot(axis,ray))));
      }
    } else if (id === 'ssn_crab') {
      // Fit the LA / pulmonary-vein window, not the ventricular valve plane.
      const points=[seeds.la,seeds.la,...['lupv','llpv','rupv','rlpv'].map(centroid).filter(Boolean)];
      normal=bestPlaneNormal(contact,points);
      target=seeds.la;
    } else if (id === 'a4c' || id === 'sub_long') {
      const points = [seeds.lv,seeds.rv,seeds.la,seeds.ra];
      // Both AV junctions must lie in the four-chamber plane; a least-squares
      // fit to chamber centres can miss a leaflet while still finding blood pools.
      normal = unit(cross(sub(h.apex,h.valves.mv),sub(h.valves.tv,h.valves.mv)));
      contact=contactOnPlane(contact,h.valves.mv,normal,id==='a4c'?'apical':'subcostal');
      target = mul(points.reduce(add,[0,0,0]),1/points.length);
    } else if (['plax','a3c','sub_lvot'].includes(id)) {
      const points = [h.apex,seeds.lv,seeds.la,h.valves.av];
      if(id!=='sub_lvot') points.push(h.valves.mv,h.valves.mv,h.valves.mv,h.valves.mv);
      if(id==='sub_lvot') points.push(h.valves.av,h.valves.av,h.valves.av,h.valves.av);
      normal = bestPlaneNormal(contact,points);
      target = mul(points.reduce(add,[0,0,0]),1/points.length);
      if(['plax','a3c','sub_lvot'].includes(id)) {
        normal=id==='sub_lvot'?unit(cross(sub(h.valves.mv,contact),sub(h.valves.av,contact))):unit(cross(sub(h.apex,h.valves.mv),sub(h.valves.av,h.valves.mv)));
        if(id!=='sub_lvot')contact=contactOnPlane(contact,h.valves.mv,normal,id==='plax'?'parasternal':'apical');
        target=mul(add(h.valves.mv,h.valves.av),.5);
      }
    } else if (['plax_rv_in','plax_rv_out','sub_rvot','a2c','a5c'].includes(id)) {
      const points = {
        plax_rv_in:[seeds.ra,seeds.rv,h.valves.tv,h.valves.tv],
        plax_rv_out:[seeds.rv,h.valves.pv,h.valves.pv,centroid('mpa')],
        sub_rvot:[seeds.rv,h.valves.pv,h.valves.pv,centroid('mpa')],
        a2c:[h.apex,seeds.lv,seeds.la,h.valves.mv],
        a5c:[h.apex,seeds.lv,h.valves.av,h.valves.av],
      }[id];
      normal=bestPlaneNormal(contact,points);
      target=mul(points.reduce(add,[0,0,0]),1/points.length);
      if(['plax_rv_out','sub_rvot'].includes(id)) {
        normal=unit(cross(sub(h.valves.pv,contact),sub(centroid('mpa'),contact)));
        target=h.valves.pv;
      }
      if(id==='a2c') {
        target=h.valves.mv;
        // Rotate the four-chamber plane about the LV long axis, rather than
        // about an arbitrary anterior contact. Otherwise the 'two chamber'
        // view can retain a large RV despite excluding the TV centre.
        const towardRV=sub(h.valves.tv,h.valves.mv);
        normal=unit(sub(towardRV,mul(h.long_axis,dot(towardRV,h.long_axis))));
        contact=contactOnPlane(contact,target,normal,'apical');
      }
    } else {
      const vesselTargets={
        ssn_arch:['aorta_asc','arch','aorta_desc'],
        high_ps_duct:['arch','lpa','mpa'],psax_pda:['aorta_desc','lpa','mpa'],
        sub_ivc:['ivc'],sub_aorta:['aorta_desc'],svc_flow:['svc'],
      }[id];
      if(!vesselTargets)return view;
      const points=vesselTargets.map(centroid).filter(Boolean);
      if(id==='sub_ivc'||id==='svc_flow')points.push(seeds.ra);
      if(id==='sub_aorta')points.push(centroid('arch'));
      normal=bestPlaneNormal(contact,points);
      target=mul(points.reduce(add,[0,0,0]),1/points.length);
    }
    let beam = this.vascular.presets[id]?.beam || unit(sub(target,contact));
    beam = unit(sub(beam,mul(normal,dot(beam,normal))));
    let index = unit(cross(normal,beam));
    if (dot(index,view.index)<0) {normal=mul(normal,-1);index=mul(index,-1)}
    if(id==='high_ps_duct' && dot(index,sub(this.vascular.landmarks.ductAo,h.valves.pv))<0) {
      normal=mul(normal,-1);index=mul(index,-1);
    }
    // Include the far myocardial wall within the selected depth, not below
    // the bottom of the fan. Do not distort the plane or the sector angle.
    const myo = this.meta.structures.find(s => s.id === 'myo');
    let depth = view.depth;
    if (myo) {
      const p = new Float32Array(this.mesh, myo.vByte, myo.vCount*3);
      for (let i=0;i<p.length;i+=3) depth = Math.max(depth,
        Math.hypot(p[i]-contact[0],p[i+1]-contact[1],p[i+2]-contact[2])+.25);
    }
    depth = Math.min(9,Math.ceil(depth*4)/4);
    const metrics={...view.metrics,phi_from_plax_deg:null,
      window_shift_mm:Math.round(Math.hypot(...sub(contact,view.window_nominal||view.contact))*100)/10};
    if(metrics.level_from_apex_mm!=null)metrics.level_from_apex_mm=Math.round(dot(sub(target,h.apex),h.long_axis)*100)/10;
    return {...view,contact,beam,index,depth,metrics,registration_note:this.vascular.presets[id]
      ? 'Connected great-vessel teaching reconstruction; illustrative dimensions, not patient-specific. Ductus shown patent as a teaching example.'
      : 'Draft reference-based anatomy and fixed-window calibration.'};
  }

  sample(p) {
    p=this.toSource(p);
    const [nx, ny, nz] = this.dims;
    const i = Math.round((p[0] - this.origin[0]) / this.step);
    const j = Math.round((p[1] - this.origin[1]) / this.step);
    const k = Math.round((p[2] - this.origin[2]) / this.step);
    if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) return 1;
    return this.labels[(i * ny + j) * nz + k];
  }

  aorticSectionVisible(plane) {
    const root = this.frame.heart.aortic_root;
    const distance = root.centre.reduce((s,x,i)=>s+(x-plane.origin[i])*plane.n[i],0);
    const alignment = Math.abs(root.axis.reduce((s,x,i)=>s+x*plane.n[i],0));
    return Math.abs(distance) < .12 && alignment > .8;
  }

  meshSections(plane) {
    const key = [...plane.origin,...plane.u,...plane.v,...plane.n].join(',');
    if (this.valveCache?.key === key) return this.valveCache.sections;
    const sections = [];
    // The source AV funnel is replaced by the explicit teaching reconstruction.
    for (const mesh of this.meta.structures) {
      const geometry=this.geometryFor(mesh);
      for(const [surface,lumen] of [[geometry,false],...(geometry.lumen?[[geometry.lumen,true]]:[])]) {
      const {positions:vertices,indices,components} = surface;
      const distances = new Float32Array(vertices.length/3);
      for(let i=0;i<distances.length;i++) distances[i] = plane.n.reduce((s,n,j)=>s+n*(vertices[i*3+j]-plane.origin[j]),0);
      for(const component of components || [{firstIndex:0,indexCount:indices.length}]) {
      const segments = [];
      for(let i=component.firstIndex;i<component.firstIndex+component.indexCount;i+=3) {
        const ids = [indices[i],indices[i+1],indices[i+2]], points=[];
        for(let edge=0;edge<3;edge++) {
          const a=ids[edge],b=ids[(edge+1)%3],da=distances[a],db=distances[b];
          if((da<0)===(db<0)) continue;
          const t=da/(da-db);
          const p=[0,1,2].map(j=>vertices[a*3+j]+t*(vertices[b*3+j]-vertices[a*3+j])-plane.origin[j]);
          points.push([p.reduce((s,x,j)=>s+x*plane.u[j],0),p.reduce((s,x,j)=>s+x*plane.v[j],0)]);
        }
        if(points.length===2) segments.push(points);
      }
      if(segments.length) sections.push({id:mesh.id,label:mesh.label,group:mesh.group,segments,lumen,network:geometry.network,blood:geometry.blood});
      }
      }
    }
    this.valveCache={key,sections};
    return sections;
  }

  valveSections(plane) {
    const valves=new Map();
    for(const s of this.meshSections(plane).filter(s=>s.group==='valve')) {
      if(!valves.has(s.id)) valves.set(s.id,{...s,segments:[]});
      valves.get(s.id).segments.push(...s.segments);
    }
    return [...valves.values()];
  }

  wallIntervals(plane,depth) {
    const wall=this.meshSections(plane).find(s=>s.id==='myo');
    const crossings=[];
    for(const [a,b] of wall?.segments || []) {
      // Half-open edge ownership avoids double counting shared vertices.
      if((a[1]>depth)===(b[1]>depth)) continue;
      crossings.push(a[0]+(depth-a[1])*(b[0]-a[0])/(b[1]-a[1]));
    }
    return crossings.sort((a,b)=>a-b);
  }

  tissueIntervals(plane,depth) {
    return this.meshSections(plane).filter(s=>(s.group==='valve' && this.showValves!==false) || (s.group==='detail' && this.showDetails!==false) || (s.group==='vessel' && this.showVessels!==false)).map(s=>{
      const crossings=[];
      for(const [a,b] of s.segments) {
        if((a[1]>depth)===(b[1]>depth)) continue;
        crossings.push(a[0]+(depth-a[1])*(b[0]-a[0])/(b[1]-a[1]));
      }
      crossings.sort((a,b)=>a-b);
      // An unclosed contour cannot establish a solid tissue interval.
      return {id:s.id,group:s.group,lumen:s.lumen,network:s.network,blood:s.blood,label:s.group==='valve'?6:0,crossings:crossings.length%2 ? [] : crossings};
    });
  }

  sampleSection(point,lateral,crossings,tissues=[]) {
    // Valve tissue takes precedence over the reconstructed vessel lumen.
    for(const tissue of tissues) {
      if(tissue.group==='vessel') continue;
      let count=0;
      for(const x of tissue.crossings) {if(x>lateral) break;count++;}
      if(count%2) return tissue.label;
    }
    // The myocardial mesh is authoritative at vessel overlaps. Separate atlas
    // vessel solids must not erase ventricular wall and create a false LV outlet.
    let hits=0;
    for(const x of crossings) {if(x>lateral) break;hits++;}
    if(hits%2) return 0;
    // Union all physical lumen surfaces BEFORE vessel walls. Otherwise each
    // branch's outer wall falsely occludes the parent vessel at its insertion.
    for(const tissue of tissues.filter(t=>t.lumen)) {
      let count=0;for(const x of tissue.crossings){if(x>lateral)break;count++;}
      if(count%2)return tissue.blood;
    }
    let vesselWall=false;
    for(const tissue of tissues) {
      if(tissue.group!=='vessel') continue;
      for(let i=0;i<tissue.crossings.length;i+=2) {
        const lo=tissue.crossings[i],hi=tissue.crossings[i+1];
        if(lateral<lo||lateral>hi) continue;
        if(tissue.network){vesselWall=true;continue;}
        // Schematic wall thickness, not a measured clinical dimension.
        const wall=Math.min(.055,(hi-lo)*.18);
        if(lateral>lo+wall&&lateral<hi-wall)
          return /aorta|arch|[lr][ul]pv/.test(tissue.id)?2:3;
        vesselWall=true;
      }
    }
    if(vesselWall) return 0;
    if(this.vascularActive)return 1; // Explicit vessel-only field, not a whole-heart section.
    let label=this.sample(point);
    if(label===0 && this.toSource && this.labels) {
      // Exact mesh intervals already established that this point is NOT wall.
      // Recover its neighbouring blood/outside label instead of turning a
      // coarse wall voxel into a black notch along the anatomical contour.
      const p=this.toSource(point),[nx,ny,nz]=this.dims;
      const ijk=p.map((x,i)=>Math.round((x-this.origin[i])/this.step));
      let best=Infinity;
      for(let a=-1;a<=1;a++)for(let b=-1;b<=1;b++)for(let c=-1;c<=1;c++){
        const q=[ijk[0]+a,ijk[1]+b,ijk[2]+c];
        if(q[0]<0||q[1]<0||q[2]<0||q[0]>=nx||q[1]>=ny||q[2]>=nz)continue;
        const candidate=this.labels[(q[0]*ny+q[1])*nz+q[2]];
        if(!candidate)continue;
        const distance=q.reduce((s,x,i)=>s+(this.origin[i]+x*this.step-p[i])**2,0);
        if(distance<best){best=distance;label=candidate;}
      }
    }
    // The mesh, not a coarse voxel, defines the myocardial boundary.
    return label===0 ? 1 : label;
  }

  drawValveSections(ctx,plane,project,monochrome=false) {
    // Papillary muscle is myocardium, not a cream/white valve outline.
    // It is already filled by sampleSection; outlining it made loops on walls.
    const sections=this.meshSections(plane).filter(s=>s.group==='valve' && this.showValves!==false);
    ctx.save(); ctx.lineCap='round'; ctx.lineJoin='round';
    // Exact intersections, not full leaflet silhouettes pasted onto each view.
    const a=project(0,0),b=project(.025,0);
    const width=Math.max(.8,Math.hypot(b[0]-a[0],b[1]-a[1]));
    for(const section of sections) {
      ctx.beginPath();
      for(const [start,end] of section.segments) {ctx.moveTo(...project(...start));ctx.lineTo(...project(...end));}
      ctx.strokeStyle=monochrome?'#c4c6cb':'#fff0d4';
      ctx.lineWidth=section.group==='detail' ? width*2 : width; ctx.stroke();
    }
    ctx.restore();
    return sections;
  }

  // Explicit educational reconstruction of a CLOSED trileaflet valve. The
  // atlas AV mesh does not resolve three individual cusps. Project root-coordinate geometry into
  // both displays, only near the basal valve plane; never follow the cursor.
  drawAorticSection(ctx, plane, project, monochrome = false) {
    if(this.showValves === false) return false;
    if (!this.aorticSectionVisible(plane)) return false;
    const root = this.frame.heart.aortic_root, axis = root.axis;
    const cross = (a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
    const e = cross(axis,[0,0,1]), length = Math.hypot(...e);
    const u = e.map(x=>x/length), v = cross(axis,u);
    const at = (angle,radius) => {
      const d = root.centre.map((x,i)=>x-plane.origin[i]+radius*(Math.cos(angle)*u[i]+Math.sin(angle)*v[i]));
      return project(d.reduce((s,x,i)=>s+x*plane.u[i],0),d.reduce((s,x,i)=>s+x*plane.v[i],0));
    };
    const centre = at(0,0), edge = at(0,root.radius);
    const scale = Math.hypot(edge[0]-centre[0],edge[1]-centre[1]);
    ctx.save();
    ctx.lineWidth = Math.max(1,scale*.07);
    for (let cusp=0;cusp<3;cusp++) {
      const start = cusp*Math.PI*2/3, end = (cusp+1)*Math.PI*2/3;
      ctx.beginPath(); ctx.moveTo(...centre);
      ctx.quadraticCurveTo(...at(start+.18,root.radius*.52),...at(start,root.radius));
      for(let k=0;k<=24;k++) ctx.lineTo(...at((cusp+k/24)*Math.PI*2/3,root.radius));
      ctx.quadraticCurveTo(...at(end+.18,root.radius*.52),...centre);
      ctx.closePath();
      // Thin echogenic coaptation/attachment lines, not opaque pie wedges.
      ctx.strokeStyle = monochrome ? '#e2e4e8' : '#fff0d4'; ctx.stroke();
    }
    ctx.restore();
    return true;
  }

  fitSector(plane,viewId) {
    // Fit intersected anatomy without changing the contact or slice plane.
    // Vessel-focused views previously fitted myocardium alone, which can
    // leave the arch or caval/ductal landmarks outside the fitted fan.
    const focus={ssn_arch:['aorta_asc','arch','aorta_desc'],ssn_crab:['lupv','llpv','rupv','rlpv','aorta_asc','mpa'],high_ps_duct:['mpa','lpa','aorta_desc'],psax_pda:['mpa','lpa','aorta_desc'],sub_ivc:['ivc'],sub_aorta:['aorta_desc'],svc_flow:['svc']}[viewId]||[];
    let radius = 2, angle = 35;
    const vascular=this.vascularFocus(plane,viewId);
    if(vascular.length) {
      for(const [x,d] of vascular) {
        if(d<.15)continue;
        radius=Math.max(radius,Math.hypot(x,d));
        angle=Math.max(angle,Math.abs(Math.atan2(x,d))*180/Math.PI);
      }
      return {depth:Math.ceil((radius+.3)*4)/4,sector:Math.min(176,Math.ceil((angle+4)*2))};
    }
    for(const section of this.meshSections(plane).filter(s=>s.id==='myo'||s.group==='valve'||focus.includes(s.id)))
    for(const segment of section.segments) for(const [x,d] of segment) {
      if(d<.15) continue;
      radius=Math.max(radius,Math.hypot(x,d));
      angle=Math.max(angle,Math.abs(Math.atan2(x,d))*180/Math.PI);
    }
    return {depth:Math.min(12,Math.ceil((radius+.45)*4)/4),
      sector:Math.min(176,Math.ceil((angle+5)*2))};
  }

  vascularFocus(plane,viewId) {
    const ids=this.vascular?.focus[viewId];if(!ids)return [];
    const ymin=viewId==='ssn_arch'?-2.35:-2.95;
    return this.meshSections(plane).filter(s=>!s.lumen&&ids.includes(s.id))
      .flatMap(s=>s.segments.flat()).filter(([x,d])=>d>.12&&
        plane.origin[1]+x*plane.u[1]+d*plane.v[1]>=ymin);
  }

  // Construct a Three.js group without making this module depend on Three.js.
  makeMeshes(THREE, clippingPlane) {
    const group = new THREE.Group();
    const colors = { wall: 0x985c60, valve: 0xe6d7c9, vessel: 0xb98e8b, detail: 0xc4847c };
    for (const s of this.meta.structures) {
      const {positions,indices} = this.geometryFor(s);
      if(!positions.length)continue;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geometry.setIndex(new THREE.BufferAttribute(indices, 1));
      geometry.computeVertexNormals();
      const material = new THREE.MeshStandardMaterial({
        color: colors[s.group] || colors.wall, roughness: 0.79,
        side: THREE.DoubleSide, clippingPlanes: [clippingPlane], clipShadows: true,
      });
      const part = new THREE.Mesh(geometry, material);
      part.userData = { id: s.id, group: s.group, registered: true };
      group.add(part);
    }
    return group;
  }
}

// Find the nearest contact on the actual schematic skin, keeping the selected
// anatomical plane exact. Contact is calibrated only on preset selection;
// subsequent sweep/rotate/rock remain fixed-window operations in Probe.
function contactOnPlane(preferred,anchor,n,window) {
  const ranges={apical:[1.5,4.52,-6.5,-3],parasternal:[.25,2.5,-4.5,-.7],subcostal:[-1.5,1.5,-6.5,-4]};
  const [xmin,xmax,ymin,ymax]=ranges[window],distance=p=>p.reduce((s,x,i)=>s+(x-anchor[i])*n[i],0);
  let best=null,score=Infinity;
  for(let y=ymin;y<=ymax;y+=.035) {
    let a=xmin,fa=distance(skinAt(a,y));
    for(let b=xmin+.06;b<=xmax+.06;b+=.06) {
      const right=Math.min(b,xmax),fb=distance(skinAt(right,y));
      if(fa*fb<=0) {
        let lo=a,hi=right,flo=fa;
        for(let k=0;k<25;k++){const mid=(lo+hi)/2,f=distance(skinAt(mid,y));if(f*flo<=0)hi=mid;else{lo=mid;flo=f;}}
        const p=skinAt((lo+hi)/2,y),s=p.reduce((v,x,i)=>v+(x-preferred[i])**2,0);
        if(s<score){score=s;best=p;}
      }
      a=right;fa=fb;if(right===xmax)break;
    }
  }
  if(!best)throw new Error(`No ${window} skin contact for the anatomical plane`);
  return best;
}

// Smallest-eigenvalue direction of a 3x3 scatter matrix: least-squares plane
// constrained to pass through the actual skin-contact point.
function bestPlaneNormal(contact, points) {
  const m = [[0,0,0],[0,0,0],[0,0,0]], v = [[1,0,0],[0,1,0],[0,0,1]];
  for (const p of points) {const d=p.map((x,i)=>x-contact[i]);for(let i=0;i<3;i++)for(let j=0;j<3;j++)m[i][j]+=d[i]*d[j]}
  for (let turn=0;turn<16;turn++) {
    let p=0,q=1;
    for(let i=0;i<3;i++)for(let j=i+1;j<3;j++)if(Math.abs(m[i][j])>Math.abs(m[p][q])){p=i;q=j}
    if(Math.abs(m[p][q])<1e-10)break;
    const angle=.5*Math.atan2(2*m[p][q],m[q][q]-m[p][p]);
    const c=Math.cos(angle),s=Math.sin(angle);
    for(let k=0;k<3;k++){const a=m[k][p],b=m[k][q];m[k][p]=c*a-s*b;m[k][q]=s*a+c*b}
    for(let k=0;k<3;k++){const a=m[p][k],b=m[q][k];m[p][k]=c*a-s*b;m[q][k]=s*a+c*b;
      const x=v[k][p],y=v[k][q];v[k][p]=c*x-s*y;v[k][q]=s*x+c*y}
  }
  const smallest=[0,1,2].sort((a,b)=>m[a][a]-m[b][b])[0];
  const n=v.map(row=>row[smallest]);
  return n.map(x=>x/Math.hypot(...n));
}
