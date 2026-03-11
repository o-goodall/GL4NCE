"use client";
import { useEffect, useRef } from "react";

export default function NetworkCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current!;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    let W: number, H: number, animId: number;
    const O = "rgba(247,147,26,", E = "rgba(0,200,255,";
    const isMob = () => window.innerWidth < 768;
    const NC = () => isMob() ? 16 : 32;
    const CD = () => isMob() ? 180 : 220;

    class Node { x:number; y:number; bx:number; by:number; da:number; ds:number; r:number;
      constructor() { this.bx=this.x=Math.random()*(W||innerWidth); this.by=this.y=Math.random()*(H||innerHeight); this.da=Math.random()*Math.PI*2; this.ds=.001+Math.random()*.002; this.r=1.5+Math.random()*1.5; }
      u() { this.da+=this.ds; this.x=this.bx+Math.sin(this.da)*12; this.y=this.by+Math.cos(this.da*.7)*10; }
      d() { ctx.beginPath(); ctx.arc(this.x,this.y,this.r,0,Math.PI*2); ctx.fillStyle=O+"0.25)"; ctx.fill(); }
    }
    class Tx { f:Node; t:Node; p:number; sp:number; h:string; sz:number; tr:{x:number;y:number;a:number}[];
      constructor(f:Node,t:Node) { this.f=f; this.t=t; this.p=0; this.sp=.008+Math.random()*.012; this.h=Math.random()<.7?"o":"e"; this.sz=1.5+Math.random()*1.5; this.tr=[]; }
      u():boolean { this.p+=this.sp; const x=this.f.x+(this.t.x-this.f.x)*this.p, y=this.f.y+(this.t.y-this.f.y)*this.p; this.tr.push({x,y,a:1}); if(this.tr.length>12)this.tr.shift(); this.tr.forEach(t=>t.a*=.88); return this.p>=1; }
      d() { const c=this.h==="o"?O:E; for(const t of this.tr){ctx.beginPath();ctx.arc(t.x,t.y,this.sz*t.a*.6,0,Math.PI*2);ctx.fillStyle=c+(t.a*.3)+")";ctx.fill();} const x=this.f.x+(this.t.x-this.f.x)*this.p,y=this.f.y+(this.t.y-this.f.y)*this.p; ctx.beginPath();ctx.arc(x,y,this.sz,0,Math.PI*2);ctx.fillStyle=c+"0.7)";ctx.shadowBlur=6;ctx.shadowColor=c+"0.5)";ctx.fill();ctx.shadowBlur=0; }
    }
    class Pg { x:number;y:number;r:number;mr:number;a:number;
      constructor(x:number,y:number){this.x=x;this.y=y;this.r=2;this.mr=18+Math.random()*12;this.a=.5;}
      u():boolean{this.r+=.4;this.a*=.96;return this.r>=this.mr||this.a<.02;}
      d(){ctx.beginPath();ctx.arc(this.x,this.y,this.r,0,Math.PI*2);ctx.strokeStyle=O+this.a+")";ctx.lineWidth=1;ctx.stroke();}
    }
    let nodes:Node[]=[],txs:Tx[]=[],pgs:Pg[]=[],st=0;
    function init(){nodes=[];txs=[];pgs=[];for(let i=0;i<NC();i++)nodes.push(new Node());}
    function spawn(){if(nodes.length<2)return;const a=nodes[Math.floor(Math.random()*nodes.length)];let b:Node|null=null,bd=Infinity;for(const n of nodes){if(n===a)continue;const dx=n.x-a.x,dy=n.y-a.y,d=Math.sqrt(dx*dx+dy*dy);if(d<CD()&&d<bd){b=n;bd=d;}}if(b)txs.push(new Tx(a,b));}
    function loop(){ctx.clearRect(0,0,W,H);const cd=CD();for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++){const dx=nodes[i].x-nodes[j].x,dy=nodes[i].y-nodes[j].y,d=Math.sqrt(dx*dx+dy*dy);if(d<cd){const a=(1-d/cd)*.04;ctx.beginPath();ctx.moveTo(nodes[i].x,nodes[i].y);ctx.lineTo(nodes[j].x,nodes[j].y);ctx.strokeStyle=O+a+")";ctx.lineWidth=.5;ctx.stroke();}} nodes.forEach(n=>{n.u();n.d();}); st++;if(st>=(isMob()?90:50)){spawn();if(Math.random()<.2){spawn();spawn();}st=0;} txs=txs.filter(t=>{const done=t.u();t.d();if(done)pgs.push(new Pg(t.t.x,t.t.y));return!done;}); pgs=pgs.filter(p=>{const done=p.u();p.d();return!done;}); animId=requestAnimationFrame(loop);}
    let rt:ReturnType<typeof setTimeout>;
    function resize(){clearTimeout(rt);rt=setTimeout(()=>{W=canvas.width=innerWidth;H=canvas.height=innerHeight;init();},200);if(!W){W=canvas.width=innerWidth;H=canvas.height=innerHeight;}}
    resize();init();loop();
    window.addEventListener("resize",resize,{passive:true});
    return()=>{cancelAnimationFrame(animId);window.removeEventListener("resize",resize);};
  },[]);
  return <canvas ref={canvasRef} id="net-canvas" aria-hidden="true" />;
}
