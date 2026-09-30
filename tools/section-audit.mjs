// Offline diagnostic rendering of the SAME sampler used in both app panels.
import fs from 'node:fs';
import zlib from 'node:zlib';
import {RegisteredHeart} from '../js/registered-heart.js';
import {Probe} from '../js/probe.js';
const json=p=>JSON.parse(fs.readFileSync(p));
const buffer=p=>{const b=fs.readFileSync(p);return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)};
const g=buffer('data/chambers.bin'),h=new DataView(g,0,28);
export const heart=new RegisteredHeart(json('data/heart_meta.json'),json('data/frame.json'),buffer('data/heart.bin'),[0,4,8].map(i=>h.getFloat32(i,true)),h.getFloat32(12,true),[16,20,24].map(i=>h.getInt32(i,true)),new Uint8Array(g,28));
export const views=json('data/views.json').views;
const add=(a,b)=>a.map((x,i)=>x+b[i]),sub=(a,b)=>a.map((x,i)=>x-b[i]),mul=(a,s)=>a.map(x=>x*s),dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0),unit=a=>mul(a,1/Math.hypot(...a));
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const crc=b=>{let c=0xffffffff;for(const v of b){c^=v;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0)}return(c^0xffffffff)>>>0};
export function png(path,w,h,rgb){const chunk=(t,b)=>{const type=Buffer.from(t),out=Buffer.alloc(b.length+12);out.writeUInt32BE(b.length);type.copy(out,4);b.copy(out,8);out.writeUInt32BE(crc(Buffer.concat([type,b])),8+b.length);return out};const head=Buffer.alloc(13);head.writeUInt32BE(w);head.writeUInt32BE(h,4);head[8]=8;head[9]=2;const rows=Buffer.alloc((w*3+1)*h);for(let y=0;y<h;y++)rgb.copy(rows,y*(w*3+1)+1,y*w*3,(y+1)*w*3);fs.writeFileSync(path,Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',head),chunk('IDAT',zlib.deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]));}
export function render(plane,centre,N=300,span=5.5){const rgb=Buffer.alloc(N*N*3),colors=[[196,125,132],[10,17,23],[161,25,48],[26,79,161],[210,51,80],[34,114,199],[255,238,202]];const c=sub(centre,plane.origin),cx=dot(c,plane.u),cy=dot(c,plane.v);for(let y=0;y<N;y++){const d=cy+(y/N-.5)*span,wall=heart.wallIntervals(plane,d),tissues=heart.tissueIntervals(plane,d);for(let x=0;x<N;x++){const lateral=cx+(x/N-.5)*span,p=add(plane.origin,add(mul(plane.u,lateral),mul(plane.v,d))),label=heart.sampleSection(p,lateral,wall,tissues);Buffer.from(colors[label]||colors[1]).copy(rgb,(y*N+x)*3)}}return rgb;}
if(process.argv[2]==='sweep'){
 const H=heart.frame.heart,base=new Probe(heart.adaptView(views.find(v=>v.id==='psax_mv'))).plane();
 const transverse=unit(sub(sub(H.valves.av,H.valves.mv),mul(H.long_axis,dot(sub(H.valves.av,H.valves.mv),H.long_axis))));
 const N=280,angles=process.argv[3]?[-40,-30,-20,-10]:[-20,0,20,40],offsets=process.argv[3]?[0,.1,.2,.3]:[0,.3,.6,.9],out=Buffer.alloc(N*N*3*16);
 let k=0;for(const offset of offsets)for(const degrees of angles){const a=degrees*Math.PI/180,n=unit(add(mul(H.long_axis,Math.cos(a)),mul(transverse,Math.sin(a)))),centre=add(H.valves.mv,mul(H.long_axis,-offset));const u=unit(cross(base.v,n)),v=cross(n,u);const plane={origin:centre,n,u,v};const rgb=render(plane,centre,N);for(let y=0;y<N;y++)rgb.copy(out,((Math.floor(k/4)*N+y)*N*4+(k%4)*N)*3,y*N*3,(y+1)*N*3);console.log(k++,{offset,degrees});}
 png('docs/echo-review/mv-plane-audit.png',N*4,N*4,out);
}
if(process.argv[2]==='views')for(const raw of views){const plane=new Probe(heart.adaptView(raw)).plane(),centre=mul(add(heart.frame.heart.apex,heart.frame.heart.base),.5);png(`docs/echo-review/audit-${raw.id}.png`,420,420,render(plane,centre,420,6.5));}
