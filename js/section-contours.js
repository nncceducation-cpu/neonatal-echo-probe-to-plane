// Closed polygon diagnostics for actual mesh/plane intersections. Open chains
// are rejected: joining their ends would invent an anatomical boundary.
export function closedContours(segments,tolerance=1e-5) {
  const key=p=>p.map(x=>Math.round(x/tolerance)).join(','),nodes=new Map(),edges=[];
  for(const [a,b] of segments){const ka=key(a),kb=key(b);if(ka===kb)continue;for(const [k,p] of [[ka,a],[kb,b]])if(!nodes.has(k))nodes.set(k,{p,edges:[]});const id=edges.length;edges.push([ka,kb]);nodes.get(ka).edges.push(id);nodes.get(kb).edges.push(id);}
  const used=new Set(),out=[];
  for(let first=0;first<edges.length;first++) {
    if(used.has(first))continue;
    const start=edges[first][0],points=[];let current=start,edge=first,closed=false;
    for(let guard=0;guard<=edges.length;guard++) {
      if(used.has(edge))break;used.add(edge);points.push(nodes.get(current).p);
      const [a,b]=edges[edge];current=a===current?b:a;
      if(current===start){closed=true;break;}
      const next=nodes.get(current).edges.filter(e=>!used.has(e));if(next.length!==1)break;edge=next[0];
    }
    if(!closed||points.length<3)continue;
    let twiceArea=0,x=0,y=0;
    for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length],c=a[0]*b[1]-b[0]*a[1];twiceArea+=c;x+=(a[0]+b[0])*c;y+=(a[1]+b[1])*c;}
    if(Math.abs(twiceArea)>1e-7)out.push({points,area:Math.abs(twiceArea/2),centre:[x/(3*twiceArea),y/(3*twiceArea)]});
  }
  return out.sort((a,b)=>b.area-a.area);
}
