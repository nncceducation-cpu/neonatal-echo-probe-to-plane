// BodyParts3D-derived, neonatal-scale mesh and chamber labels.
// Both displays sample the same patient-frame data; this remains a teaching
// approximation, not a diagnostic reconstruction or ultrasound simulation.
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
  }

  adaptView(view) {
    const h = this.frame.heart, seeds = this.frame.chamber_seeds;
    const sub = (a,b) => a.map((x,i) => x-b[i]);
    const add = (a,b) => a.map((x,i) => x+b[i]);
    const mul = (a,s) => a.map(x => x*s);
    const dot = (a,b) => a.reduce((s,x,i) => s+x*b[i],0);
    const cross = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
    const unit = a => mul(a,1/Math.hypot(...a));
    const contact = view.contact, id = view.id;
    let target, normal;
    if (id.startsWith('psax_') && ['psax_av','psax_mv','psax_pap','psax_apical'].includes(id)) {
      const fraction = {psax_av:1,psax_mv:.77,psax_pap:.44,psax_apical:.18}[id];
      target = id === 'psax_av' ? h.valves.av : id === 'psax_mv' ? h.valves.mv
        : add(h.apex,mul(sub(h.base,h.apex),fraction));
      const ray = unit(sub(target,contact));
      const axis = id === 'psax_av' ? h.aortic_root.axis : h.long_axis;
      normal = unit(sub(axis,mul(ray,dot(axis,ray))));
    } else if (id === 'a4c' || id === 'sub_long') {
      const points = [seeds.lv,seeds.rv,seeds.la,seeds.ra];
      normal = bestPlaneNormal(contact,points);
      target = mul(points.reduce(add,[0,0,0]),1/points.length);
    } else if (['plax','a3c','sub_lvot'].includes(id)) {
      const points = [h.apex,seeds.lv,seeds.la,h.valves.av];
      if(id==='sub_lvot') points.push(h.valves.av,h.valves.av,h.valves.av,h.valves.av);
      normal = bestPlaneNormal(contact,points);
      target = mul(points.reduce(add,[0,0,0]),1/points.length);
    } else if (['plax_rv_in','plax_rv_out','sub_rvot','a2c','a5c'].includes(id)) {
      const points = {
        plax_rv_in:[seeds.ra,seeds.rv,h.valves.tv,h.valves.tv],
        plax_rv_out:[seeds.rv,h.valves.pv,h.valves.pv],
        sub_rvot:[seeds.rv,h.valves.pv,h.valves.pv],
        a2c:[h.apex,seeds.lv,seeds.la,h.valves.mv],
        a5c:[h.apex,seeds.lv,h.valves.av,h.valves.av],
      }[id];
      normal=bestPlaneNormal(contact,points);
      target=mul(points.reduce(add,[0,0,0]),1/points.length);
    } else return view;
    let beam = unit(sub(target,contact));
    beam = unit(sub(beam,mul(normal,dot(beam,normal))));
    let index = unit(cross(normal,beam));
    if (dot(index,view.index)<0) {normal=mul(normal,-1);index=mul(index,-1)}
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
    return {...view,beam,index,depth,registration_note:'Probe plane fitted to the registered anatomy.'};
  }

  sample(p) {
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
    for (const mesh of this.meta.structures.filter(s=>s.group === 'valve' || s.group === 'detail' || s.id === 'myo')) {
      const vertices = new Float32Array(this.mesh,mesh.vByte,mesh.vCount*3);
      const indices = new Uint32Array(this.mesh,mesh.iByte,mesh.iCount*3);
      const distances = new Float32Array(mesh.vCount);
      for(let i=0;i<mesh.vCount;i++) distances[i] = plane.n.reduce((s,n,j)=>s+n*(vertices[i*3+j]-plane.origin[j]),0);
      const segments = [];
      for(let i=0;i<indices.length;i+=3) {
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
      if(segments.length) sections.push({id:mesh.id,label:mesh.label,group:mesh.group,segments});
    }
    this.valveCache={key,sections};
    return sections;
  }

  valveSections(plane) {
    return this.meshSections(plane).filter(s=>s.group==='valve');
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

  sampleSection(point,lateral,crossings) {
    let hits=0;
    for(const x of crossings) {if(x>lateral) break;hits++;}
    if(hits%2) return 0;
    const label=this.sample(point);
    // The mesh, not a coarse voxel, defines the myocardial boundary.
    return label===0 ? 1 : label;
  }

  drawValveSections(ctx,plane,project,monochrome=false) {
    const sections=this.meshSections(plane).filter(s=>(s.group==='valve' && this.showValves!==false) || (s.group==='detail' && this.showDetails!==false));
    ctx.save(); ctx.lineCap='round'; ctx.lineJoin='round';
    // Exact intersections, not full leaflet silhouettes pasted onto each view.
    const a=project(0,0),b=project(.025,0);
    const width=Math.max(.8,Math.hypot(b[0]-a[0],b[1]-a[1]));
    for(const section of sections) {
      if(section.id==='av' && this.aorticSectionVisible(plane)) continue;
      ctx.beginPath();
      for(const [start,end] of section.segments) {ctx.moveTo(...project(...start));ctx.lineTo(...project(...end));}
      ctx.strokeStyle=monochrome?'#c4c6cb':'#fff0d4';
      ctx.lineWidth=section.group==='detail' ? width*2 : width; ctx.stroke();
    }
    ctx.restore();
    this.drawAorticSection(ctx,plane,project,monochrome);
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

  fitSector(plane) {
    // Fit intersected anatomy without changing the contact or slice plane.
    let radius = 2, angle = 35;
    for (let d=.15; d<=8.5; d+=.12) for (let x=-8; x<=8; x+=.12) {
      const p=plane.origin.map((o,i)=>o+plane.u[i]*x+plane.v[i]*d);
      if (this.sample(p) === 1) continue;
      radius=Math.max(radius,Math.hypot(x,d));
      angle=Math.max(angle,Math.abs(Math.atan2(x,d))*180/Math.PI);
    }
    return {depth:Math.min(12,Math.ceil((radius+.45)*4)/4),
      sector:Math.min(176,Math.ceil((angle+5)*2))};
  }

  // Construct a Three.js group without making this module depend on Three.js.
  makeMeshes(THREE, clippingPlane) {
    const group = new THREE.Group();
    const colors = { wall: 0x985c60, valve: 0xe6d7c9, vessel: 0xb98e8b, detail: 0xc4847c };
    for (const s of this.meta.structures) {
      const positions = new Float32Array(this.mesh, s.vByte, s.vCount * 3);
      const indices = new Uint32Array(this.mesh, s.iByte, s.iCount * 3);
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
