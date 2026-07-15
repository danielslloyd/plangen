// VALIDATED v2 core reference implementation (headless). See hex_economy_v2_spec.md §11.
// Run: node hex_economy_v2_core.js
// Confirmed: pop 15->~390 vs K_sub=382, food produced=eaten, zero oscillation at K0=0.5,
// cities self-limit, P_rich=1.36 > P_poor=0.95. This is the equilibrium to port into the HTML.
// v2 core spatial WITH subsistence floor. Workers unable to earn the market wage
// subsist-farm viable land (eat locally). This lets population bootstrap & fill the map.
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const c=1, kappa=4, r=0.10, K0=0.5;
const u=0.5, alpha=1.05+0.45*u, p=1.40+0.45*u;
let Z=0; for(let j=1;j<=200000;j++) Z+=Math.pow(j,-p);
const ROWS=10,COLS=14, DIRS=[[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1]];
let hexes=[],am={};
for(let rr=0;rr<ROWS;rr++)for(let col=0;col<COLS;col++){const q=col-Math.floor(rr/2);const i=hexes.length;hexes.push({i,q,r:rr,col,C:3,isCity:false});am[q+","+rr]=i;}
const nbn=i=>{const h=hexes[i],o=[];for(const[dq,dr]of DIRS){const j=am[(h.q+dq)+","+(h.r+dr)];if(j!==undefined)o.push(j);}return o;};
const gh=(cc,rr)=>hexes.find(h=>h.col===cc&&h.r===rr);
[[4,4,9],[10,6,9],[7,2,6]].forEach(([bc,br,C])=>hexes.forEach(h=>{if(Math.hypot(h.col-bc,h.r-br)<2.3&&C>h.C)h.C=C;}));
const CITY=[{cc:3,rr:3,A:9.0},{cc:11,rr:7,A:4.5}];   // rich vs poor
CITY.forEach(o=>{const h=gh(o.cc,o.rr);h.isCity=true;h.A=o.A;});
const cityIdx=hexes.filter(h=>h.isCity).map(h=>h.i), Aof={}; cityIdx.forEach(k=>Aof[k]=hexes[k].A);
let tbc={}; (function ct(){tbc={};const n=hexes.length;for(const src of cityIdx){const d=new Float64Array(n).fill(Infinity);d[src]=0;const done=new Uint8Array(n);
  for(let it=0;it<n;it++){let uu=-1,b=Infinity;for(let k=0;k<n;k++)if(!done[k]&&d[k]<b){b=d[k];uu=k;}if(uu<0)break;done[uu]=1;
    for(const v of nbn(uu))if(d[uu]+K0<d[v])d[v]=d[uu]+K0;}tbc[src]=d;}})();
// subsistence capacity per hex: L where F(L)=L*c
function Lsub(C){ if(C<=kappa*c) return 0; let lo=0,hi=50; for(let i=0;i<50;i++){const L=0.5*(lo+hi); (C*(1-Math.exp(-L/kappa)) > L*c)?lo=L:hi=L;} return 0.5*(lo+hi); }
hexes.forEach(h=>h.Lsub=Lsub(h.C));
const Ksub=hexes.reduce((a,h)=>a+h.Lsub,0);
const NofCity=(A,T)=> T<=0?1e9:Math.pow(T*Z/A,1/(alpha-p));
function mkt(C,nb,w){ if(nb<=0)return{L:0,F:0}; const E=(c+w/nb)*kappa/C; if(E>=1)return{L:0,F:0}; return{L:-kappa*Math.log(E),F:C*(1-E)}; }
function innerP(w,Pw){ // per-city price bisection to clear city food markets (market farming only)
  const P={},lo={},hi={}; cityIdx.forEach(k=>{P[k]=Pw[k]??1;lo[k]=0.01;hi[k]=300;});
  for(let rd=0;rd<45;rd++){ const sup={}; cityIdx.forEach(k=>sup[k]=0);
    for(const h of hexes){ if(h.isCity)continue; let best=-Infinity,bk=-1;
      for(const k of cityIdx){const t=tbc[k][h.i];if(!isFinite(t))continue;const v=P[k]-t;if(v>best){best=v;bk=k;}}
      if(best>0){const f=mkt(h.C,best,w); sup[bk]+=Math.max(0,f.F-f.L*c);} }
    cityIdx.forEach(k=>{const dem=c*NofCity(Aof[k],w+P[k]*c); (dem-sup[k]>0)?lo[k]=P[k]:hi[k]=P[k]; P[k]=0.5*(lo[k]+hi[k]);}); }
  return P;
}
// formal labor demand (market farmers + city workers) at wage w
function formal(w,Pw){ const P=innerP(w,Pw); let Lm=0,Nc=0; const mktL=new Float64Array(hexes.length);
  for(const h of hexes){ if(h.isCity)continue; let best=-Infinity;
    for(const k of cityIdx){const t=tbc[k][h.i];if(isFinite(t))best=Math.max(best,P[k]-t);}
    if(best>0){const f=mkt(h.C,best,w); Lm+=f.L; mktL[h.i]=f.L;} }
  cityIdx.forEach(k=>Nc+=NofCity(Aof[k],w+P[k]*c));
  return {P,Lm,Nc,formal:Lm+Nc,mktL};
}
function solve(N,Pw){
  // if formal(0) >= N -> labor scarce, w>0 bisect; else w=0 + subsistence absorbs residual
  const f0=formal(1e-5,Pw);
  let out;
  if(f0.formal>=N){ let wlo=1e-5,whi=100,P=Pw; for(let it=0;it<38;it++){const wm=0.5*(wlo+whi);const f=formal(wm,P);P=f.P;(f.formal>N)?wlo=wm:whi=wm;out={...f,w:wm};} out.subs=0; out.room=0; }
  else { const residual=N-f0.formal; let subRoom=0; hexes.forEach(h=>{if(!h.isCity)subRoom+=Math.max(0,h.Lsub-f0.mktL[h.i]);});
    out={...f0,w:0,subs:Math.min(residual,subRoom),room:Math.max(0,subRoom-residual),residual}; }
  return out;
}
let N=15,Pw={};
console.log(`subsistence carrying cap Ksub=${Ksub.toFixed(0)}  CHEAP K0=${K0}  rich A=${CITY[0].A} poor A=${CITY[1].A}`);
console.log('t    N     mktFarm cityPop subsist  w      Prich Ppoor  rich>poor?');
let hist=[];
for(let t=1;t<=300;t++){ const s=solve(N,Pw); Pw=s.P;
  const supported=s.formal+ (s.subs||0);
  let sig; if(s.w>1e-4) sig=1; else if((s.room||0)>0.5) sig=0.5; else if(N>supported+0.5) sig=-1; else sig=0;
  N=Math.max(0.1,N + r*N*Math.tanh(sig));
  if(t<=2||t%50===0){const kR=cityIdx[0],kP=cityIdx[1];
    console.log(`${String(t).padStart(3)} ${N.toFixed(1).padStart(6)} ${s.Lm.toFixed(1).padStart(7)} ${s.Nc.toFixed(1).padStart(6)} ${(s.subs||0).toFixed(1).padStart(7)}  ${s.w.toFixed(3).padStart(5)} ${s.P[kR].toFixed(2).padStart(5)} ${s.P[kP].toFixed(2).padStart(5)}  ${s.P[kR]>s.P[kP]?'YES':'no'}`);}
  hist.push(N); }
const osc=Math.abs(hist.at(-1)-hist.at(-2))>0.2||Math.abs(hist.at(-1)-hist.at(-4))>0.2;
console.log(`\nfinal N=${N.toFixed(1)} (cap ~${Ksub.toFixed(0)})  oscillating=${osc}`);
