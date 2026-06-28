/* ════════════════════════════════════════════════════════════════
   vfx-arcanum.js ── arcanum WebGL2 VFX 통합
   = __ARC 엔진(헤드리스패치) + arc-bridge
   exports: VFXArcBridge (default+named)
   의존: three(importmap). window.__ARC 자체노출
   ════════════════════════════════════════════════════════════════ */
import * as THREE from 'three';

/* ===== [1] arcanum 엔진 (window.__ARC) ===== */
/* ════════════════════════════════════════════════════════════════
   vfx-arcanum-engine.js ── arcanum WebGL2 bloom 엔진 + 53효과 (헤드리스 패치)
   출처: VFX_arcanum_통합 / __ARC 엔진(L111-7461)
   인터페이스: A.reg 효과. 게임용 헤드리스 메서드 추가됨(하단 PATCH)
   ════════════════════════════════════════════════════════════════ */

/* ===== ARCANUM-CORE ENGINE ===== */
(function(){
"use strict";

/* ---------- math helpers (JS 전역 — GLSL 빌트인 사용 금지 규칙 준수) ---------- */
const clamp=(x,a,b)=>x<a?a:(x>b?b:x);
const lerp=(a,b,t)=>a+(b-a)*t;
const smoothstep=(e0,e1,x)=>{const t=clamp((x-e0)/(e1-e0),0,1);return t*t*(3-2*t);};
const TAU=Math.PI*2;
const rnd=(a,b)=>a+Math.random()*(b-a);
const easeOutCubic=t=>1-Math.pow(1-t,3);
const easeOutQuart=t=>1-Math.pow(1-t,4);
const easeOutBack=t=>{const c1=1.70158,c3=c1+1;const u=t-1;return 1+c3*u*u*u+c1*u*u;};
function vnoise(x,y){
 const xi=Math.floor(x),yi=Math.floor(y),xf=x-xi,yf=y-yi;
 const u=xf*xf*(3-2*xf),v=yf*yf*(3-2*yf);
 const h=(a,b)=>{const s=Math.sin(a*127.1+b*311.7)*43758.5453;return s-Math.floor(s);};
 const a=h(xi,yi),b=h(xi+1,yi),c=h(xi,yi+1),d=h(xi+1,yi+1);
 return a+(b-a)*u+(c-a)*v+(a-b-c+d)*u*v;
}
function curl2(x,y,t){
 const e=0.6;
 const dx=(vnoise(x+e,y+t)-vnoise(x-e,y+t))/(2*e);
 const dy=(vnoise(x+t,y+e)-vnoise(x+t,y-e))/(2*e);
 return [dy,-dx];
}

/* ---------- DOM ---------- */
const $=s=>document.querySelector(s);
let canvas=$('#cv');
const errBox=$('#err');
function fatal(msg){if(errBox){errBox.style.display='block';errBox.textContent+=msg+"\n";}console.error(msg);}

/* ---------- global state ---------- */
let gl=null,W=0,H=0,DPR=1,SC=1;
let _headless=false;   /* [GAME] 헤드리스 모드: RAF 자율구동 끄고 외부 pump */
let timeNow=0,lastT=0,rafId=0;
let shake=0,shakeX=0,shakeY=0;
let flash=0,flashR=1,flashG=1,flashB=1;
let caSpike=0;
let curIdx=0,autoAt=0;
let booted=false;
let paused=false;
function shakeAdd(a){shake=Math.max(shake,a);}
function flashAdd(a,r,g,b){if(a>flash){flash=a;flashR=r;flashG=g;flashB=b;}}

/* ---------- context loss 복구: swapCanvas ---------- */
let recoverArmed=true,lastRecover=0;
function attachCanvas(c){
 c.addEventListener('webglcontextlost',e=>{e.preventDefault();tryRecover();},false);
 c.addEventListener('pointerdown',onPointer,false);
}
function swapCanvas(){
 const nc=canvas.cloneNode(false);
 canvas.parentNode.replaceChild(nc,canvas);
 canvas=nc;attachCanvas(canvas);
}
function tryRecover(){
 const now=performance.now();
 if(!recoverArmed||now-lastRecover<2000)return;
 recoverArmed=false;lastRecover=now;
 setTimeout(()=>{swapCanvas();boot();recoverArmed=true;},150);
}

/* ---------- GLSL 공통 청크 ---------- */
const NOISE=[
'float h21(vec2 p){vec3 q=fract(vec3(p.xyx)*0.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}',
'float n2(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);',
' float a=h21(i),b=h21(i+vec2(1.,0.)),c=h21(i+vec2(0.,1.)),d=h21(i+vec2(1.,1.));',
' return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);}',
'float fbm2(vec2 p){float v=0.,a=.5;for(int i=0;i<5;i++){v+=a*n2(p);p=p*2.07+vec2(19.3,7.1);a*=.5;}return v;}',
'float h31(vec3 p){p=fract(p*0.1031);p+=dot(p,p.yzx+33.33);return fract((p.x+p.y)*p.z);}',
'float n3(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);',
' float a=h31(i),b=h31(i+vec3(1.,0.,0.)),c=h31(i+vec3(0.,1.,0.)),d=h31(i+vec3(1.,1.,0.));',
' float e=h31(i+vec3(0.,0.,1.)),g=h31(i+vec3(1.,0.,1.)),hh=h31(i+vec3(0.,1.,1.)),k=h31(i+vec3(1.,1.,1.));',
' return mix(mix(mix(a,b,f.x),mix(c,d,f.x),f.y),mix(mix(e,g,f.x),mix(hh,k,f.x),f.y),f.z);}',
'float fbm3(vec3 p){float v=0.,a=.5;for(int i=0;i<4;i++){v+=a*n3(p);p=p*2.03+vec3(11.7,5.3,2.9);a*=.5;}return v;}'
].join('\n');
/* 풀스크린 삼각형 — gl_VertexID 삼항(검증 규칙 고정형) */
const FS_VERT=[
'#version 300 es',
'void main(){',
' vec2 p=gl_VertexID==0?vec2(-1.,-1.):gl_VertexID==1?vec2(3.,-1.):vec2(-1.,3.);',
' gl_Position=vec4(p,0.,1.);',
'}'
].join('\n');

/* ---------- program / FBO util ---------- */
function mkShader(type,src,name){
 const s=gl.createShader(type);
 gl.shaderSource(s,src);gl.compileShader(s);
 if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)){
  fatal('['+name+'] shader: '+gl.getShaderInfoLog(s));return null;}
 return s;
}
function mkProg(vs,fs,name){
 const v=mkShader(gl.VERTEX_SHADER,vs,name+'-vs');
 const f=mkShader(gl.FRAGMENT_SHADER,fs,name+'-fs');
 if(!v||!f)return null;
 const p=gl.createProgram();
 gl.attachShader(p,v);gl.attachShader(p,f);gl.linkProgram(p);
 if(!gl.getProgramParameter(p,gl.LINK_STATUS)){
  fatal('['+name+'] link: '+gl.getProgramInfoLog(p));return null;}
 return p;
}
function U(p,names){if(!p)return {p:null};const o={p};for(const n of names)o[n]=gl.getUniformLocation(p,n);return o;}
function makeFBO(w,h){
 const tex=gl.createTexture();
 gl.bindTexture(gl.TEXTURE_2D,tex);
 gl.texStorage2D(gl.TEXTURE_2D,1,gl.RGBA8,w,h);
 gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
 gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
 gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
 gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
 const fb=gl.createFramebuffer();
 gl.bindFramebuffer(gl.FRAMEBUFFER,fb);
 gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,tex,0);
 gl.bindFramebuffer(gl.FRAMEBUFFER,null);
 return {tex,fb,w,h};
}
function freeFBO(f){if(!f)return;gl.deleteFramebuffer(f.fb);gl.deleteTexture(f.tex);}
function drawTri(){gl.drawArrays(gl.TRIANGLES,0,3);}

/* ---------- 입자 풀: 고정 typed array · swap-kill · 풀 초과시 무시(누수 0) ---------- */
const POOLS=[];
const STRIDE=9;
class Pool{
 constructor(cap){
  this.cap=cap;this.n=0;
  this.px=new Float32Array(cap);this.py=new Float32Array(cap);
  this.vx=new Float32Array(cap);this.vy=new Float32Array(cap);
  this.life=new Float32Array(cap);this.maxLife=new Float32Array(cap);
  this.size=new Float32Array(cap);this.rot=new Float32Array(cap);this.rv=new Float32Array(cap);
  this.r=new Float32Array(cap);this.g=new Float32Array(cap);this.b=new Float32Array(cap);
  this.a=new Float32Array(cap);this.shape=new Float32Array(cap);this.seed=new Float32Array(cap);
  this.drag=new Float32Array(cap);this.grav=new Float32Array(cap);
  this.buf=new Float32Array(cap*STRIDE);
  this.vbo=null;this.vao=null;
  POOLS.push(this);
 }
 initGL(){
  this.vbo=gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER,this.vbo);
  gl.bufferData(gl.ARRAY_BUFFER,this.buf.byteLength,gl.DYNAMIC_DRAW);
  this.vao=gl.createVertexArray();
  gl.bindVertexArray(this.vao);
  gl.bindBuffer(gl.ARRAY_BUFFER,this.vbo);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0,3,gl.FLOAT,false,STRIDE*4,0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1,4,gl.FLOAT,false,STRIDE*4,12);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2,2,gl.FLOAT,false,STRIDE*4,28);
  gl.bindVertexArray(null);
 }
 clear(){this.n=0;}
 spawn(px,py,vx,vy,life,size,r,g,b,a,shape,o){
  if(this.n>=this.cap)return -1;
  const i=this.n++;
  this.px[i]=px;this.py[i]=py;this.vx[i]=vx;this.vy[i]=vy;
  this.life[i]=life;this.maxLife[i]=life;this.size[i]=size;
  this.r[i]=r;this.g[i]=g;this.b[i]=b;this.a[i]=a;this.shape[i]=shape;
  this.rot[i]=o&&o.rot!==undefined?o.rot:0;
  this.rv[i]=o&&o.rv!==undefined?o.rv:0;
  this.drag[i]=o&&o.drag!==undefined?o.drag:0;
  this.grav[i]=o&&o.grav!==undefined?o.grav:0;
  this.seed[i]=o&&o.seed!==undefined?o.seed:Math.random();
  return i;
 }
 kill(i){
  const j=--this.n;
  if(i===j)return;
  this.px[i]=this.px[j];this.py[i]=this.py[j];this.vx[i]=this.vx[j];this.vy[i]=this.vy[j];
  this.life[i]=this.life[j];this.maxLife[i]=this.maxLife[j];this.size[i]=this.size[j];
  this.rot[i]=this.rot[j];this.rv[i]=this.rv[j];this.r[i]=this.r[j];this.g[i]=this.g[j];
  this.b[i]=this.b[j];this.a[i]=this.a[j];this.shape[i]=this.shape[j];this.seed[i]=this.seed[j];
  this.drag[i]=this.drag[j];this.grav[i]=this.grav[j];
 }
 update(dt,t,fn){
  for(let i=this.n-1;i>=0;i--){
   this.life[i]-=dt;
   if(this.life[i]<=0){this.kill(i);continue;}
   if(fn)fn(this,i,dt,t);
   const dr=Math.exp(-this.drag[i]*dt);
   this.vx[i]*=dr;this.vy[i]*=dr;
   this.vy[i]+=this.grav[i]*dt;
   this.px[i]+=this.vx[i]*dt;this.py[i]+=this.vy[i]*dt;
   this.rot[i]+=this.rv[i]*dt;
  }
 }
 fill(){
  const b=this.buf;let o=0;
  for(let i=0;i<this.n;i++){
   const f=clamp(this.life[i]/this.maxLife[i]*3.3,0,1);
   b[o++]=this.px[i];b[o++]=this.py[i];b[o++]=this.size[i];
   b[o++]=this.r[i];b[o++]=this.g[i];b[o++]=this.b[i];b[o++]=this.a[i]*f;
   b[o++]=this.rot[i];b[o++]=this.shape[i];
  }
  return this.n;
 }
}

/* ---------- 입자 셰이더 (shape: 0 glow / 1 feather / 2 shard / 3 smoke) ---------- */
const PART_VS=[
'#version 300 es',
'layout(location=0) in vec3 aPos;',
'layout(location=1) in vec4 aCol;',
'layout(location=2) in vec2 aMisc;',
'uniform vec2 uRes;',
'out vec4 vCol;out vec2 vMisc;',
'void main(){',
' vec2 ndc=aPos.xy/uRes*2.-1.;',
' gl_Position=vec4(ndc,0.,1.);',
' gl_PointSize=aPos.z;',
' vCol=aCol;vMisc=aMisc;',
'}'
].join('\n');
const PART_FS=[
'#version 300 es',
'precision highp float;',
'in vec4 vCol;in vec2 vMisc;',
'out vec4 o;',
'void main(){',
' vec2 p=gl_PointCoord*2.-1.;',
' float cs=cos(vMisc.x),sn=sin(vMisc.x);',
' p=mat2(cs,-sn,sn,cs)*p;',
' float shp=vMisc.y;',
' float a;',
' if(shp<0.5){',
'  float r=length(p);',
'  a=exp(-r*r*4.)*(1.-smoothstep(.7,1.,r));',
' }else if(shp<1.5){',
'  vec2 q=vec2(p.x*2.3,p.y);',
'  float r=length(q);',
'  float body=1.-smoothstep(.5,.95,r);',
'  float spine=1.-smoothstep(0.,.16,abs(p.x));',
'  a=body*(.5+.5*spine)*(.62+.38*(.5-.5*p.y));',
' }else if(shp<2.5){',
'  float ang=atan(p.y,p.x);',
'  float rr=length(p);',
'  float k=.6+.3*abs(cos(ang*2.5+vMisc.x*2.));',
'  a=1.-smoothstep(max(k-.2,0.),k,rr);',
' }else if(shp<3.5){',
'  float r=length(p);',
'  a=(1.-smoothstep(.15,1.,r))*.85;',
' }else{',
'  vec2 ap=vec2(abs(p.x),p.y);',
'  float uw=1.-smoothstep(.55,1.05,length((ap-vec2(.40,.32))/vec2(.52,.44)));',
'  float lw=1.-smoothstep(.55,1.05,length((ap-vec2(.32,-.40))/vec2(.40,.52)));',
'  float bd=(1.-smoothstep(.07,.15,ap.x))*(1.-smoothstep(.2,.95,abs(p.y)));',
'  a=clamp(max(max(uw,lw),bd),0.,1.)*(1.-smoothstep(.9,1.25,length(p)));',
' }',
' o=vec4(vCol.rgb,vCol.a*a);',
'}'
].join('\n');

/* ---------- 포스트 파이프라인 ---------- */
const BRIGHT_FS=[
'#version 300 es',
'precision highp float;',
'uniform sampler2D uTex;uniform vec2 uRes;',
'out vec4 o;',
'void main(){',
' vec3 c=texture(uTex,gl_FragCoord.xy/uRes).rgb;',
' float l=dot(c,vec3(.299,.587,.114));',
' o=vec4(c*smoothstep(.5,1.05,l),1.);',
'}'
].join('\n');
const BLUR_FS=[
'#version 300 es',
'precision highp float;',
'uniform sampler2D uTex;uniform vec2 uRes,uDir;',
'out vec4 o;',
'void main(){',
' vec2 uv=gl_FragCoord.xy/uRes;',
' vec3 c=texture(uTex,uv).rgb*.227;',
' c+=(texture(uTex,uv+uDir*1.384).rgb+texture(uTex,uv-uDir*1.384).rgb)*.316;',
' c+=(texture(uTex,uv+uDir*3.230).rgb+texture(uTex,uv-uDir*3.230).rgb)*.0703;',
' o=vec4(c,1.);',
'}'
].join('\n');
const COMP_FS=[
'#version 300 es',
'precision highp float;',
'uniform sampler2D uScene,uBloom;',
'uniform vec2 uRes,uShake;',
'uniform float uCA,uBloomAmt,uFlash;',
'uniform vec3 uFlashCol;',
'out vec4 o;',
'void main(){',
' vec2 uv=gl_FragCoord.xy/uRes+uShake;',
' vec2 d=(uv-.5)*uCA;',
' vec3 col;',
' col.r=texture(uScene,uv-d).r;',
' col.g=texture(uScene,uv).g;',
' col.b=texture(uScene,uv+d).b;',
' col+=texture(uBloom,uv).rgb*uBloomAmt;',
' float v=1.-dot(uv-.5,uv-.5)*.9;',
' col*=v;',
' col+=uFlashCol*uFlash;',
' col=col/(1.+col*.12);',
' o=vec4(col,1.);',
'}'
].join('\n');

/* ---------- 리본(트라이앵글 스트립) 셰이더 — FX-108 ---------- */
const RIB_VS=[
'#version 300 es',
'layout(location=0) in vec2 aPos;',
'layout(location=1) in vec2 aUV;',
'layout(location=2) in float aFade;',
'uniform vec2 uRes;',
'out vec2 vUV;out float vFade;',
'void main(){',
' vec2 n=aPos/uRes*2.-1.;',
' gl_Position=vec4(n,0.,1.);',
' vUV=aUV;vFade=aFade;',
'}'
].join('\n');
const RIB_FS=[
'#version 300 es',
'precision highp float;',
'in vec2 vUV;in float vFade;',
'uniform float uTime;',
'out vec4 o;',
NOISE,
'void main(){',
' float v=vUV.y*2.-1.;',
' float u=vUV.x;',
' float t1=fbm2(vec2(u*5.5-uTime*2.1,v*1.8));',
' float t2=fbm2(vec2(u*11.+uTime*1.3,v*3.5+u*2.));',
' float lick=fbm2(vec2(u*7.5-uTime*1.1,1.7));',
' float edge=1.-smoothstep(.25+.55*lick,1.,abs(v));',
' float flame=edge*(.35+.55*t1+.35*t2);',
' float blade=exp(-v*v*42.)*(1.-smoothstep(.04,.22,vFade));',
' vec3 c=mix(vec3(1.7,1.85,2.1),vec3(1.65,1.12,.42),smoothstep(0.,.10,vFade));',
' c=mix(c,vec3(1.4,.45,.09),smoothstep(.10,.42,vFade));',
' c=mix(c,vec3(.55,.08,.03),smoothstep(.42,.9,vFade));',
' float flick=.8+.35*n2(vec2(u*30.,uTime*13.));',
' float a=flame*(1.-smoothstep(.55,1.,vFade))*flick;',
' a+=blade*1.2;',
' o=vec4(c+vec3(.6,.7,1.)*blade,a);',
'}'
].join('\n');

/* ---------- GL globals ---------- */
let fboScene=null,fboBright=null,fboBlurA=null,fboBlurB=null;
let progPart=null,progBright=null,progBlur=null,progComp=null,progRib=null;
let HW=1,HH=1;

function resize(){
 DPR=Math.min(window.devicePixelRatio||1,1.8);
 let w,h;
 if(_headless){ DPR=1; w=Math.max(2,canvas.width||512); h=Math.max(2,canvas.height||512); }
 else { const box=canvas.parentNode.getBoundingClientRect();
   w=Math.max(2,Math.floor(box.width*DPR));
   h=Math.max(2,Math.floor(box.height*DPR)); }
 if(w===W&&h===H&&fboScene)return;
 W=w;H=h;
 canvas.width=W;canvas.height=H;
 SC=clamp(Math.min(W,H)/900,0.55,2.2);
 freeFBO(fboScene);freeFBO(fboBright);freeFBO(fboBlurA);freeFBO(fboBlurB);
 HW=Math.max(1,W>>1);HH=Math.max(1,H>>1);
 fboScene=makeFBO(W,H);
 fboBright=makeFBO(HW,HH);
 fboBlurA=makeFBO(HW,HH);
 fboBlurB=makeFBO(HW,HH);
 for(const e of EFFECTS)if(e.resize)e.resize();
}

function drawPool(pool,dstFactor){
 const n=pool.fill();
 if(!n)return;
 gl.useProgram(progPart.p);
 gl.uniform2f(progPart.uRes,W,H);
 gl.blendFunc(gl.SRC_ALPHA,dstFactor);
 gl.bindVertexArray(pool.vao);
 gl.bindBuffer(gl.ARRAY_BUFFER,pool.vbo);
 gl.bufferSubData(gl.ARRAY_BUFFER,0,pool.buf.subarray(0,n*STRIDE));
 gl.drawArrays(gl.POINTS,0,n);
 gl.bindVertexArray(null);
}
function ADD(){return gl.ONE;}
function ALPHA(){return gl.ONE_MINUS_SRC_ALPHA;}

/* ---------- pointer ---------- */
function onPointer(e){
 const r=canvas.getBoundingClientRect();
 const x=(e.clientX-r.left)*DPR;
 const y=H-(e.clientY-r.top)*DPR;
 const E=EFFECTS[curIdx];
 if(E&&E.trigger)E.trigger(x,y);
}

/* ---------- effects registry ---------- */
const EFFECTS=[];

/* ---------- boot ---------- */
function boot(){
 gl=canvas.getContext('webgl2',{alpha:false,antialias:false,depth:false,
  stencil:false,preserveDrawingBuffer:false,powerPreference:'high-performance'});
 if(!gl){fatal('WebGL2 미지원 환경');return;}
 if(gl.isContextLost()){fatal('초기 컨텍스트 유실 — 복구 대기');return;}
 errBox.textContent='';errBox.style.display='none';
 fboScene=fboBright=fboBlurA=fboBlurB=null;
 progPart=U(mkProg(PART_VS,PART_FS,'particle'),['uRes']);
 progBright=U(mkProg(FS_VERT,BRIGHT_FS,'bright'),['uTex','uRes']);
 progBlur=U(mkProg(FS_VERT,BLUR_FS,'blur'),['uTex','uRes','uDir']);
 progComp=U(mkProg(FS_VERT,COMP_FS,'comp'),['uScene','uBloom','uRes','uShake','uCA','uBloomAmt','uFlash','uFlashCol']);
 progRib=U(mkProg(RIB_VS,RIB_FS,'ribbon'),['uRes','uTime']);
 for(const p of POOLS)p.initGL();
 resize();
 for(const e of EFFECTS)e.init();
 EFFECTS[curIdx].reset();
 autoAt=timeNow+0.7;
 if(!booted){booted=true;lastT=performance.now();if(!_headless)rafId=requestAnimationFrame(frame);}
}

/* ---------- main loop ---------- */
let fpsE=60,partN=0,hudT=0;
function frame(now){
 if(!_headless)rafId=requestAnimationFrame(frame);
 if(!gl||gl.isContextLost())return;
 if(!progComp||!progComp.p||!fboScene)return;
 let dt=(now-lastT)/1000;lastT=now;
 if(dt>0.05)dt=0.05;
 if(dt<=0)return;
 if(paused)dt=0;
 const E=EFFECTS[curIdx];
 if(dt>0){
  timeNow+=dt;
  fpsE=lerp(fpsE,1/dt,0.05);
  shake=Math.max(0,shake-(shake*5+2)*dt);
  flash=Math.max(0,flash-(flash*6+1.2)*dt);
  caSpike=Math.max(0,caSpike-caSpike*4*dt);
  shakeX=(Math.random()*2-1)*shake;
  shakeY=(Math.random()*2-1)*shake;
  if(autoAt&&timeNow>autoAt){
   autoAt=0;
   const p=E.autoPoint?E.autoPoint():[W*0.5,H*0.5];
   E.trigger(p[0],p[1]);
  }
  E.update(dt,timeNow);
 }
 /* scene pass */
 gl.bindFramebuffer(gl.FRAMEBUFFER,fboScene.fb);
 gl.viewport(0,0,W,H);
 gl.disable(gl.BLEND);
 E.drawField(timeNow);
 gl.enable(gl.BLEND);
 E.drawParticles(timeNow);
 gl.disable(gl.BLEND);
 /* bloom: bright → blur x2 */
 gl.bindFramebuffer(gl.FRAMEBUFFER,fboBright.fb);
 gl.viewport(0,0,HW,HH);
 gl.useProgram(progBright.p);
 gl.activeTexture(gl.TEXTURE0);
 gl.bindTexture(gl.TEXTURE_2D,fboScene.tex);
 gl.uniform1i(progBright.uTex,0);
 gl.uniform2f(progBright.uRes,HW,HH);
 drawTri();
 blurPass(fboBright,fboBlurA,1.3,0);
 blurPass(fboBlurA,fboBlurB,0,1.3);
 blurPass(fboBlurB,fboBlurA,2.6,0);
 blurPass(fboBlurA,fboBlurB,0,2.6);
 /* composite */
 gl.bindFramebuffer(gl.FRAMEBUFFER,null);
 gl.viewport(0,0,W,H);
 gl.useProgram(progComp.p);
 gl.activeTexture(gl.TEXTURE0);
 gl.bindTexture(gl.TEXTURE_2D,fboScene.tex);
 gl.activeTexture(gl.TEXTURE1);
 gl.bindTexture(gl.TEXTURE_2D,fboBlurB.tex);
 gl.uniform1i(progComp.uScene,0);
 gl.uniform1i(progComp.uBloom,1);
 gl.uniform2f(progComp.uRes,W,H);
 gl.uniform2f(progComp.uShake,shakeX/W,shakeY/H);
 gl.uniform1f(progComp.uCA,0.0012+caSpike);
 gl.uniform1f(progComp.uBloomAmt,E.bloom!==undefined?E.bloom:0.95);
 gl.uniform1f(progComp.uFlash,flash);
 gl.uniform3f(progComp.uFlashCol,flashR,flashG,flashB);
 drawTri();
 /* HUD */
 hudT+=dt;
 if(hudT>0.25){
  hudT=0;
  partN=E.countParticles?E.countParticles():0;
  const _hud=$('#hud');if(_hud)_hud.textContent='FPS '+fpsE.toFixed(0)+' · PARTICLES '+partN+' · '+W+'x'+H;
 }
}
function blurPass(src,dst,dx,dy){
 gl.bindFramebuffer(gl.FRAMEBUFFER,dst.fb);
 gl.viewport(0,0,dst.w,dst.h);
 gl.useProgram(progBlur.p);
 gl.activeTexture(gl.TEXTURE0);
 gl.bindTexture(gl.TEXTURE_2D,src.tex);
 gl.uniform1i(progBlur.uTex,0);
 gl.uniform2f(progBlur.uRes,dst.w,dst.h);
 gl.uniform2f(progBlur.uDir,dx/src.w,dy/src.h);
 drawTri();
}

/* ---------- UI: vfx-merged 스타일 카드 갤러리 ---------- */
const TAGS={
 'ARC-33':['t-water|GALE','t-void|SPIRIT','t-tier-s|S'],
 'ARC-25':['t-void|BLACKHOLE','t-dark|SCYTHE','t-tier-b|B'],
 'ARC-32':['t-void|MIRROR','t-ice|SHATTER','t-tier-b|B'],
 'ARC-22':['t-void|REND','t-dark|FRACTURE','t-tier-a|A'],
 'ARC-23':['t-dark|SLASH','t-void|CRIMSON','t-tier-a|A'],
 'ARC-24':['t-flora|LOTUS','t-void|ABYSS','t-tier-a|A'],
 'ARC-31':['t-void|THUNDER','t-water|RUNE-3D','t-tier-c|C'],
 'ARC-26':['t-void|THUNDER','t-water|WARD','t-tier-a|A'],
 'ARC-27':['t-fire|MAGMA','t-dark|CRUST','t-tier-a|A'],
 'ARC-28':['t-water|AURORA','t-void|VEIL','t-tier-c|C'],
 'ARC-29':['t-flora|LOTUS','t-fire|CRIMSON','t-tier-s|S'],
 'ARC-30':['t-dark|TORNADO','t-water|STORM','t-tier-s|S'],
 'FX-88':['t-fire|FIRE','t-dark|DARK','t-tier-a|A'],
 'FX-89':['t-void|VOID','t-tier-s|S'],
 'FX-92':['t-fire|FIRE','t-tier-s|S'],
 'FX-104':['t-ice|ICE','t-tier-b|B'],
 'FX-108':['t-fire|FIRE','t-tier-b|B'],
 'FX-99':['t-fire|METEOR','t-tier-a|A'],
 'FX-101':['t-flora|BLOOD','t-dark|DARK','t-tier-s|S'],
 'FX-103':['t-water|WATER','t-tier-s|S'],
 'FX-110':['t-fire|RUNE','t-dark|SEAL','t-tier-a|A'],
 'FX-111':['t-water|WATER','t-ice|VORTEX','t-tier-s|S'],
 'NX-01':['t-dark|CHAIN','t-flora|BLOOD','t-tier-s|S'],
 'NX-05':['t-ice|ICE','t-flora|LOTUS','t-tier-s|S'],
 'NX-07':['t-void|STORM','t-fire|SCORCH','t-tier-s|S'],
 'FX-120':['t-fire|DIVINE','t-tier-s|S'],
 'FX-121':['t-void|QUANTUM','t-dark|EXEC','t-tier-s|S'],
 'FX-122':['t-dark|IAI','t-ice|STEEL','t-tier-s|S'],
 'FX-125':['t-fire|GOLD','t-void|FRACTAL','t-tier-s|S'],
 'FX-126':['t-void|TIME','t-dark|REWIND','t-tier-s|S'],
 'FX-130':['t-fire|NUKE','t-dark|FALLOUT','t-tier-a|A'],
 'FX-124':['t-flora|TREE','t-water|AEGIS','t-tier-s|S'],
 'FB-01':['t-dark|INK','t-fire|SEAL','t-tier-b|B'],
 'NX-08':['t-ice|ICE','t-void|SIGIL','t-tier-s|S'],
 'ARC-21':['t-fire|MAGMA','t-dark|TECTONIC','t-tier-s|S'],
 'NX-10':['t-water|VORTEX','t-void|ABYSS','t-tier-s|S'],
 'FX-138':['t-void|VOID','t-dark|SINGULARITY','t-tier-s|S'],
 'FX-140':['t-flora|LOTUS','t-fire|DIVINE','t-tier-s|S'],
 'FX-141':['t-water|EMERALD','t-void|ARRAY','t-tier-s|S'],
 'FX-142':['t-fire|FIRE','t-void|VORTEX','t-tier-s|S'],
 'FX-146':['t-void|PRISM','t-flora|SCATTER','t-tier-s|S'],
 'FX-150':['t-fire|CROSS','t-water|ORBITAL','t-tier-s|S'],
 'FX-151':['t-void|ATTRACTOR','t-water|FILIGREE','t-tier-s|S'],
 'FX-152':['t-dark|REND','t-void|VORTEX','t-tier-s|S'],
 'FX-153':['t-void|MAGENTA','t-fire|MEGALASER','t-tier-s|S'],
 'FX-154':['t-water|CIRCUIT','t-void|CASCADE','t-tier-s|S'],
 'FX-155':['t-flora|BUTTERFLY','t-void|BARRAGE','t-tier-s|S'],
 'FX-156':['t-fire|DIVINE','t-fire|LANCE','t-tier-s|S'],
 'FX-157':['t-ice|PRISM','t-void|SPIRAL','t-tier-s|S'],
 'FX-158':['t-fire|HELIX','t-water|WAVE','t-tier-s|S'],
 'FX-159':['t-water|COMET','t-void|LANCE','t-tier-a|A'],
 'FX-160':['t-flora|SERPENT','t-water|FLUX','t-tier-a|A'],
 'FX-161':['t-void|SINGULARITY','t-dark|LENS','t-tier-s|S']
};
let observer=null;
function mountTo(i){
 const sec=document.querySelector('.fx-sec[data-i="'+i+'"]');
 if(!sec)return;
 sec.querySelector('.fx-mount').appendChild(canvas);
 document.querySelectorAll('.fx-sec').forEach(s=>{
  const on=+s.dataset.i===i;
  s.classList.toggle('active',on);
  const ph=s.querySelector('.ph');if(ph)ph.style.display=on?'none':'flex';
 });
}
function activate(i){
 if(i===curIdx){mountTo(i);return;}
 if(EFFECTS[curIdx])EFFECTS[curIdx].reset();
 curIdx=i;
 mountTo(i);
 if(gl&&!gl.isContextLost())resize();
 EFFECTS[curIdx].reset();
 shake=0;flash=0;caSpike=0;paused=false;
 autoAt=timeNow+0.45;
 document.querySelectorAll('.fx-bar [data-act="pause"]').forEach(b=>b.textContent='\u23f8 \uc77c\uc2dc\uc815\uc9c0');
}
function buildUI(){
 const wrap=$('#cards');
 const TIER_START={'ARC-21':'TIER S \u00b7 \uc989\uc2dc \uc0ac\uc6a9 \uac00\ub2a5','ARC-22':'TIER A \u00b7 \ub2e8\uc21c \uac1c\uc120\uc73c\ub85c \uad6c\uc81c \uac00\ub2a5','ARC-25':'TIER B \u00b7 \uad6c\uc870\uc801 \uac1c\uc120/\ud310\ub2e8 \ud544\uc694','ARC-28':'TIER C \u00b7 \ubcf4\uadf8\ub798\ubd80\ub784 \uc804\uc2dc\uc6a9'};
 EFFECTS.forEach((e,i)=>{
  if(TIER_START[e.id]){
   const div=document.createElement('div');div.className='tier-divider';
   div.innerHTML='<span>'+TIER_START[e.id]+'</span>';
   wrap.appendChild(div);
  }
  const sec=document.createElement('section');
  sec.className='fx-sec';sec.dataset.i=i;
  const tg=(TAGS[e.id]||[]).map(t=>{const s=t.split('|');return '<span class="tag '+s[0]+'">'+s[1]+'</span>';}).join('');
  sec.innerHTML='<div class="row"><span class="fid">'+e.id+'</span>'+tg+'</div>'
   +'<h2>'+e.name+'</h2><div class="en">'+e.en+'</div>'
   +'<div class="fx-stage"><div class="fx-mount"></div>'
   +'<div class="ph">\uc2a4\ud06c\ub864 \uc9c4\uc785 \uc2dc \uc790\ub3d9 \uc7ac\uc0dd \u00b7 \ud0ed\ud558\uc5ec \ubc1c\ub3d9</div>'
   +'<div class="fx-label"><span class="li">'+e.id+'</span><span class="ln">'+e.name+'</span></div></div>'
   +'<div class="fx-bar"><button class="bbtn prime" data-act="fire">\u25c9 \ub2e4\uc2dc \ubc1c\ub3d9</button>'
   +'<button class="bbtn" data-act="pause">\u23f8 \uc77c\uc2dc\uc815\uc9c0</button>'
   +'<span class="hint">\uce94\ubc84\uc2a4 \ud0ed \u2192 \uc88c\ud45c \ubc1c\ub3d9</span></div>'
   +'<div class="ds">'+e.desc+'</div>'
   +'<div class="chips">'+e.tech.map(t=>'<span class="ch">'+t+'</span>').join('')+'</div>';
  sec.querySelector('[data-act="fire"]').addEventListener('click',ev=>{ev.stopPropagation();
   activate(i);const e2=EFFECTS[i];const p=e2.autoPoint?e2.autoPoint():[W*0.5,H*0.5];e2.trigger(p[0],p[1]);});
  sec.querySelector('[data-act="pause"]').addEventListener('click',ev=>{ev.stopPropagation();
   if(curIdx!==i)activate(i);paused=!paused;ev.target.textContent=paused?'\u25b6 \uc7ac\uc0dd':'\u23f8 \uc77c\uc2dc\uc815\uc9c0';if(!paused)lastT=performance.now();});
  wrap.appendChild(sec);
 });
 $('#cnt').textContent=EFFECTS.length+' EFFECTS \u00b7 \uc138\ub85c \uc2a4\ud06c\ub864 \uc7ac\uc0dd';
 mountTo(0);
 const ratios={};
 observer=new IntersectionObserver(ents=>{
  ents.forEach(en=>{ratios[+en.target.dataset.i]=en.intersectionRatio;});
  let best=curIdx,bestR=0;
  for(const k in ratios){if(ratios[k]>bestR){bestR=ratios[k];best=+k;}}
  if(bestR>=0.5&&best!==curIdx)activate(best);
 },{threshold:[0,.25,.5,.6,.75,1]});
 document.querySelectorAll('.fx-sec').forEach(s=>observer.observe(s));
}

window.addEventListener('resize',()=>{if(gl&&!gl.isContextLost())resize();});
window.__ARC={
 reg:e=>EFFECTS.push(e),
 start:()=>{attachCanvas(canvas);buildUI();boot();},
 /* ── [GAME] 헤드리스 단일효과 구동 API ──────────────────────────
    bootHeadless(c) → 오프스크린 canvas 주입 + GL부트(buildUI/RAF 없음)
    select(id|idx)  → curIdx 전환 + reset
    fire(x,y)       → 현재효과 트리거 (x null → autoPoint 중앙)
    pump(nowMs)     → 1프레임 렌더(게임 animate가 매틱 호출)
    idList()        → 등록 효과 id 목록 */
 bootHeadless:c=>{_headless=true;canvas=c;attachCanvas(c);boot();return!!gl;},
 mountCanvas:c=>{canvas=c;attachCanvas(c);},
 select:idOrIdx=>{
   const i=(typeof idOrIdx==='number')?idOrIdx:EFFECTS.findIndex(e=>e.id===idOrIdx);
   if(i<0||i>=EFFECTS.length)return false;
   if(EFFECTS[curIdx]&&EFFECTS[curIdx].reset)EFFECTS[curIdx].reset();
   curIdx=i; if(EFFECTS[i].reset)EFFECTS[i].reset(); return true;
 },
 fire:(x,y)=>{const e=EFFECTS[curIdx];if(!e)return;
   const p=(x==null&&e.autoPoint)?e.autoPoint():[x,y];
   if(e.trigger)e.trigger(p[0],p[1]);},
 pump:now=>{frame(now);},
 idList:()=>EFFECTS.map(e=>e.id),
 env:{
  get gl(){return gl;},get W(){return W;},get H(){return H;},get SC(){return SC;},
  Pool,U,mkProg,FS_VERT,NOISE,drawPool,ADD,ALPHA,drawTri,
  shakeAdd,flashAdd,setCA:v=>{caSpike=Math.max(caSpike,v);},
  clamp,lerp,smoothstep,TAU,rnd,easeOutCubic,easeOutQuart,easeOutBack,vnoise,curl2,
  get progRib(){return progRib;}
 }
};
})();

/* ===== EFFECTS (A.reg) ===== */
(function(){
"use strict";
const A=window.__ARC,E=A.env;
const FS=[
'#version 300 es',
'precision highp float;',
'#define TAU 6.2831853',
'uniform vec2 uRes,uC;',
'uniform float uTime,uQuake,uHeat,uYsq;',
'out vec4 o;',
E.NOISE,
'void main(){',
' float mn=min(uRes.x,uRes.y);',
' vec2 fc=(gl_FragCoord.xy-uC)/mn;',
' vec2 gp=vec2(fc.x,fc.y/uYsq);',
' float d=length(gp);',
' vec3 col=mix(vec3(.030,.016,.012),vec3(.006,.003,.004),clamp(fc.y*.6+.5,0.,1.));',
' col+=vec3(.10,.04,.02)*exp(-d*2.2)*.5;',
/* expanding shock front */
' float front=uQuake*1.15;',
' float ring=exp(-pow((d-front)*5.,2.));',
/* fbm crack veins */
' float v=fbm2(gp*4.5+vec2(0.,uTime*.04));',
' float cr=1.-smoothstep(.0,.055,abs(v-.5));',
' float v2=fbm2(gp*9.+vec2(3.1,1.7));',
' float cr2=1.-smoothstep(.0,.03,abs(v2-.5));',
' float reveal=1.-smoothstep(front,front+.25,d);',
' reveal*=smoothstep(.0,.1,uQuake);',
' float crackI=(cr*.8+cr2*.5)*reveal;',
/* molten ramp */
' float heat=crackI*(.6+.8*ring)+ring*.5+exp(-d*5.)*uHeat;',
' vec3 ember=mix(vec3(.5,.05,.01),vec3(1.3,.45,.06),smoothstep(.0,.5,heat));',
' ember=mix(ember,vec3(1.6,1.1,.5),smoothstep(.5,1.1,heat));',
' col+=ember*heat*uQuake;',
' col+=vec3(1.4,.7,.25)*ring*uQuake*.8;',
/* heat shimmer near ground */
' float sh=n2(vec2(fc.x*20.,uTime*4.))*exp(-abs(fc.y+.2)*3.);',
' col+=vec3(.3,.12,.05)*sh*uHeat*.4;',
' col+=(h21(fc*uRes+uTime)-.5)*.012;',
' o=vec4(col,1.);',
'}'
].join('\n');

const rock=new E.Pool(512);
const ember=new E.Pool(768);
const dust=new E.Pool(256);
let prog=null;
const RAD=[0.12,0.30,0.48,0.66];
const TIM=[0.0,0.10,0.22,0.36];
const st={phase:0,timer:0,cx:0,cy:0,gy:0,rx:0,quake:0,heat:0,step:0};

function groundFn(p,i,dt){
 if(p.py[i]<st.gy&&p.vy[i]<0){p.py[i]=st.gy;p.vy[i]*=-0.32;p.vx[i]*=0.6;p.rv[i]*=0.5;
  if(Math.abs(p.vy[i])<50*E.SC){p.vy[i]=0;p.grav[i]=0;}}
}
function eruptRing(r){
 const a0=Math.random()*E.TAU;
 const cnt=10+Math.round(r*22);
 for(let k=0;k<cnt;k++){
  const a=a0+k/cnt*E.TAU;
  const px=st.cx+Math.cos(a)*r*st.rx;
  const py=st.gy+Math.sin(a)*r*st.rx*0.40;
  const out=E.rnd(40,180)*E.SC;
  rock.spawn(px,py,Math.cos(a)*out,E.rnd(320,920)*E.SC,
   E.rnd(1.4,2.6),E.rnd(7,20)*E.SC,
   .55,.30,.18,E.rnd(.7,.95),2,
   {rot:Math.random()*E.TAU,rv:E.rnd(-7,7),drag:.4,grav:-1450*E.SC});
  for(let j=0;j<2;j++)
   ember.spawn(px,py,Math.cos(a)*out*.6+E.rnd(-60,60)*E.SC,E.rnd(220,760)*E.SC,
    E.rnd(.45,1.1),E.rnd(3,8)*E.SC,1.5,.55,.12,E.rnd(.6,.95),0,{drag:1.6,grav:-620*E.SC});
  dust.spawn(px,py,Math.cos(a)*out*.4,E.rnd(40,160)*E.SC,
   E.rnd(1.6,3.2),E.rnd(40,95)*E.SC,.35,.24,.20,E.rnd(.10,.22),3,
   {drag:.8,rot:Math.random()*E.TAU,rv:E.rnd(-.5,.5),grav:-40*E.SC});
 }
 E.shakeAdd(14*E.SC);
}
function geom(){
 st.cx=E.W*0.5;st.cy=E.H*0.44;st.gy=st.cy;st.rx=Math.min(E.W,E.H)*0.5;
}
A.reg({
 id:'ARC-21',name:'지각 융기 · 용암 균열',en:'Tectonic Surge',
 desc:'중심→외곽 순차 분화. 충격파 전선이 fbm 균열망을 용암색으로 점화(ease-out)하며 확장, 환상 배열로 암석·잉걸·분진이 상방 분출 후 중력 낙하·바닥 탄성 안착. 감쇠형 화면 진동 동반.',
 tech:['fbm Crack Network','Expanding Shock Front','Sequential Ring Eruption','Up-Thrust Debris Physics','Floor Bounce Settle','Heat Shimmer + Shake'],
 bloom:0.92,
 init(){
  prog=E.U(E.mkProg(E.FS_VERT,FS,'ARC21'),['uRes','uC','uTime','uQuake','uHeat','uYsq']);
  geom();
 },
 reset(){rock.clear();ember.clear();dust.clear();st.phase=0;st.timer=0;st.quake=0;st.heat=0;st.step=0;geom();},
 resize(){geom();},
 autoPoint(){return [E.W*0.5,E.H*0.44];},
 trigger(x,y){
  if(st.phase!==0)return;
  st.cx=x;st.cy=E.clamp(y,E.H*0.32,E.H*0.60);st.gy=st.cy;
  st.phase=1;st.timer=0;st.step=0;
  E.flashAdd(.5,1.1,.6,.2);E.shakeAdd(16*E.SC);E.setCA(.006);
 },
 update(dt,t){
  st.timer+=dt;
  if(st.phase===0){
   st.quake=Math.max(0,st.quake-dt*0.8);
   st.heat=Math.max(0,st.heat-dt*1.0);
  }else if(st.phase===1){
   st.quake=Math.min(1,E.easeOutCubic(Math.min(1,st.timer/0.6)));
   st.heat=Math.min(1,st.heat+dt*2.5);
   while(st.step<RAD.length&&st.timer>=TIM[st.step]){eruptRing(RAD[st.step]);st.step++;}
   if(st.timer>3.6){st.phase=0;st.timer=0;}
  }
  rock.update(dt,t,groundFn);
  ember.update(dt,t,null);
  dust.update(dt,t,null);
 },
 drawField(t){
  if(!prog||!prog.p)return;const g=E.gl;
  g.useProgram(prog.p);
  g.uniform2f(prog.uRes,E.W,E.H);
  g.uniform2f(prog.uC,st.cx||E.W*0.5,st.cy||E.H*0.44);
  g.uniform1f(prog.uTime,t);
  g.uniform1f(prog.uQuake,st.quake);
  g.uniform1f(prog.uHeat,st.heat);
  g.uniform1f(prog.uYsq,0.42);
  E.drawTri();
 },
 drawParticles(){
  E.drawPool(dust,E.ALPHA());
  E.drawPool(rock,E.ADD());
  E.drawPool(ember,E.ADD());
 },
 countParticles(){return rock.n+ember.n+dust.n;}
});
})();
(function(){
"use strict";
const A=window.__ARC,E=A.env;
const FS=`#version 300 es
precision highp float;
out vec4 o;
uniform vec2 uRes; uniform float uTime,uOpen,uCore,uFade;
float h3(vec3 p){ return fract(sin(dot(p,vec3(17.1,113.5,71.7)))*43758.5453); }
float n3(vec3 p){ vec3 i=floor(p),f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(mix(h3(i),h3(i+vec3(1,0,0)),f.x),mix(h3(i+vec3(0,1,0)),h3(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(h3(i+vec3(0,0,1)),h3(i+vec3(1,0,1)),f.x),mix(h3(i+vec3(0,1,1)),h3(i+vec3(1,1,1)),f.x),f.y),f.z); }
float fbm3(vec3 p){ float s=0.,a=.5; for(int i=0;i<4;i++){ s+=a*n3(p); p*=2.03; a*=.5; } return s; }
/* one ring of FILLED lotus petals (soft painterly, not line rings) */
vec3 lotusRing(float r,float th,float K,float Rad,float open,float rot,vec3 base,vec3 tip,float t){
  float a=th*K+rot;
  float lobe=0.5+0.5*cos(a);
  float warp=fbm3(vec3(cos(th)*r,sin(th)*r,t*0.2)*2.0)*0.04;
  float outer=Rad*open*(0.40+0.60*lobe)+warp;
  float inner=Rad*open*0.10;
  float body=smoothstep(inner,inner+0.03,r)*(1.-smoothstep(outer-0.05,outer,r));
  float amask=smoothstep(0.10,0.50,lobe);
  float fill=body*amask;
  float g=clamp((r-inner)/max(outer-inner,1e-3),0.,1.);
  vec3 col=mix(base,tip,g*g);
  col+=tip*smoothstep(outer-0.06,outer,r)*amask*0.7;          // luminous outer rim
  float vein=smoothstep(0.85,1.0,lobe)*body;
  col+=mix(tip,vec3(1.0,0.82,0.5),0.4)*vein*0.35;             // golden central vein
  return col*fill;
}
void main(){
  vec2 uv=((gl_FragCoord.xy/uRes)*2.-1.); uv.x*=uRes.x/uRes.y;
  float r=length(uv), th=atan(uv.y,uv.x);
  vec3 col=mix(vec3(0.10,0.02,0.05),vec3(0.015,0.004,0.018),clamp(r,0.,1.));
  float haze=fbm3(vec3(uv*1.4,uTime*0.05));
  col+=vec3(0.35,0.06,0.14)*haze*haze*(1.-smoothstep(0.,1.2,r))*0.6;
  /* cinematic bokeh motes */
  float bok=0.;
  for(int i=0;i<6;i++){ float fi=float(i);
    float ang=fi*1.047+uTime*0.15; float rr=fract(fi*0.37+uTime*0.06)*1.1;
    vec2 bp=vec2(cos(ang),sin(ang))*rr; float d=length(uv-bp);
    bok+=(1.-smoothstep(0.0,0.07,d))*0.4;
  }
  col+=vec3(1.0,0.6,0.7)*bok*uOpen*0.5;
  vec3 base=vec3(0.55,0.03,0.12), mid=vec3(1.0,0.20,0.40), hot=vec3(1.0,0.45,0.62);
  float o1=smoothstep(0.0,0.5,uOpen), o2=smoothstep(0.2,0.7,uOpen), o3=smoothstep(0.4,1.0,uOpen);
  col+=lotusRing(r,th,3.0,0.42,o1, uTime*0.10, base,      mid, uTime);
  col+=lotusRing(r,th,6.0,0.66,o2,-uTime*0.07, base*1.1,  hot, uTime)*0.9;
  col+=lotusRing(r,th,9.0,0.92,o3, uTime*0.05, vec3(0.7,0.10,0.22), vec3(1.0,0.6,0.55), uTime)*0.8;
  /* glowing golden core */
  float coreR=0.10+fbm3(vec3(uv*2.2,uTime*0.4))*0.05;
  float core=1.-smoothstep(coreR,coreR+0.04,r);
  float caustic=0.7+0.3*n3(vec3(uv*8.,uTime*0.8));
  col+=mix(vec3(1.0,0.85,0.5),vec3(1.0,1.0,0.85),core)*core*caustic*(0.8+uCore*1.6);
  col+=vec3(1.0,0.7,0.5)*exp(-r*r*6.0)*(0.4+uCore*1.2);
  /* petal-meteor expansion shock at full bloom */
  float shock=(1.-smoothstep(0.0,0.04,abs(r-uOpen*1.15)))*smoothstep(0.5,1.0,uOpen);
  col+=vec3(1.0,0.5,0.5)*shock*0.6;
  col*=1.-smoothstep(0.75,1.25,r)*0.7;
  col*=uFade;
  o=vec4(col,1.);
}`;
let prog=null; const st={t:0};
A.reg({
 id:'ARC-29',name:'진홍 연꽃 만다라',en:'Crimson Lotus Mandala',
 desc:'황금 코어 점화 → 채운 다층 연꽃잎(3·6·9겹) ease-out 개화·발광 림·황금 정맥·보케·개화 충격 링. 진홍→로즈→핫핑크. 클릭 재개화.',
 tech:['Filled Layered Petals','Staggered Bloom','Golden Core Caustic','Bokeh Motes','Expansion Shock'],bloom:0.92,
 init(){prog=E.U(E.mkProg(E.FS_VERT,FS,'ARC29'),['uRes','uTime','uOpen','uCore','uFade']);},
 reset(){st.t=0;},
 resize(){},
 autoPoint(){return [E.W*0.5,E.H*0.5];},
 trigger(x,y){ st.t=0; },
 update(dt,t){st.t+=dt;},
 drawField(t){if(!prog||!prog.p)return;const g=E.gl;g.useProgram(prog.p);
  g.uniform2f(prog.uRes,E.W,E.H);g.uniform1f(prog.uTime,st.t);
  let open,core=0,fade=1;{const P=10.0,ph=st.t%P;if(ph<0.5){core=E.smoothstep(0,0.5,ph);open=0;}else if(ph<3.5){core=1-E.smoothstep(0.5,1.4,ph);open=1.0-Math.pow(1.0-E.smoothstep(0.5,3.5,ph),3.0);}else{open=1;}if(ph>=7.5)fade=1-E.smoothstep(7.5,P,ph);}g.uniform1f(prog.uOpen,open);g.uniform1f(prog.uCore,core);g.uniform1f(prog.uFade,fade);
  E.drawTri();},
 drawParticles(){},
 countParticles(){return 0;}
});
})();
(function(){
"use strict";
const A=window.__ARC,E=A.env;
const FS=`#version 300 es
precision highp float;
out vec4 o;
uniform vec2 uRes; uniform float uTime,uFade;
float h3(vec3 p){ return fract(sin(dot(p,vec3(17.1,113.5,71.7)))*43758.5453); }
float n3(vec3 p){ vec3 i=floor(p),f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(mix(h3(i),h3(i+vec3(1,0,0)),f.x),mix(h3(i+vec3(0,1,0)),h3(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(h3(i+vec3(0,0,1)),h3(i+vec3(1,0,1)),f.x),mix(h3(i+vec3(0,1,1)),h3(i+vec3(1,1,1)),f.x),f.y),f.z); }
float fbm3(vec3 p){ float s=0.,a=.5; for(int i=0;i<4;i++){ s+=a*n3(p); p*=2.03; a*=.5; } return s; }
void main(){
  vec2 uv=(gl_FragCoord.xy/uRes)*2.-1.; uv.x*=uRes.x/uRes.y;
  vec3 ro=vec3(0.,0.9,-5.2);
  vec3 rd=normalize(vec3(uv.x, uv.y-0.12, 1.9));
  float spin=uTime*2.2, twist=7.0, ybot=-1.0, ytop=3.0;
  float t=0.5, tr=1.; vec3 acc=vec3(0.);
  for(int i=0;i<64;i++){
    vec3 p=ro+rd*t;
    if(p.y<ybot-0.4) break;
    float hh=clamp((p.y-ybot)/(ytop-ybot),0.,1.);
    float R=0.05+0.52*pow(hh,0.85);
    float wob=0.16*sin(p.y*1.2-uTime*1.1)+0.10*cos(p.y*0.6+uTime*0.7);
    vec2 pc=vec2(p.x-wob, p.z-0.10*sin(p.y*0.8-uTime));
    float rr=length(pc); float a=atan(pc.y,pc.x);
    float bands=pow(clamp(0.5+0.5*sin(a*7.+hh*twist-spin),0.,1.),1.5);
    float n=fbm3(vec3(a*2.+hh*twist-spin, hh*6.-uTime*0.7, rr*2.2));
    float thick=0.10+0.30*hh;
    float shell=exp(-pow((rr-R)/thick,2.));
    float core=1.-exp(-pow(rr/(R*0.6+1e-3),2.));
    float body=shell*(0.25+1.0*n)*(0.4+0.8*bands);
    float skirt=exp(-pow((p.y-ybot)/0.45,2.))*exp(-pow(rr/(R+0.9),2.))*0.8;
    float inside=step(0.02,hh)*step(hh,0.985);
    float d=clamp(body*inside+skirt,0.,1.6);
    if(d>0.01){
      float em=clamp(n*bands,0.,1.);
      vec3 base=vec3(0.26+0.40*em, 0.24+0.37*em, 0.23+0.34*em);
      base=base*0.8+vec3(0.14,0.17,0.22)*0.2;
      float rim=clamp(-rd.x*0.5+0.5,0.,1.)*pow(em,2.)*0.4;
      base+=vec3(0.6,0.55,0.5)*rim;
      base*=core*0.7+0.3;
      float av=1.-exp(-d*0.085*3.0);
      acc+=base*av*tr; tr*=1.-av; if(tr<0.04) break;
    }
    t+=0.085;
  }
  vec3 col=acc*1.30; // 배경 없음(게임VFX) — 펀넬이 흑배경 위 발광
  float deb=step(0.985, n3(vec3(uv*40.+vec2(sin(uTime*3.),cos(uTime*2.)), uTime*2.)));
  col+=vec3(0.30,0.28,0.26)*deb*smoothstep(-0.6,-0.1,uv.y)*0.5;
  col+=(h3(vec3(uv*uRes.xy*0.6,uTime))-0.5)*0.01;
  col*=uFade;
  o=vec4(col,1.);
}`;
let prog=null; const st={t:0};
A.reg({
 id:'ARC-30',name:'폭풍 토네이도',en:'Storm Tornado',
 desc:'3D 볼류메트릭 토네이도 — 좁은 바닥→넓은 상단 회전 더스트 펀넬(중공 코어)·방황 중심축·회전 더스트 밴드·지면 충돌 더스트·디브리. 흑배경 분리형(게임VFX). 64스텝 레이마치.',
 tech:['Volumetric Raymarch Funnel','Rotating Dust Bands','Wandering Axis','Ground Dust Skirt','Background-free'],bloom:0.7,
 init(){prog=E.U(E.mkProg(E.FS_VERT,FS,'ARC30'),['uRes','uTime','uFade']);},
 reset(){st.t=0;},
 resize(){},
 autoPoint(){return [E.W*0.5,E.H*0.5];},
 trigger(x,y){ st.t=0; },
 update(dt,t){st.t+=dt;},
 drawField(t){if(!prog||!prog.p)return;const g=E.gl;g.useProgram(prog.p);
  g.uniform2f(prog.uRes,E.W,E.H);g.uniform1f(prog.uTime,st.t);
  let fade=1;{const P=20.0,ph=st.t%P;if(ph<1.5)fade=E.smoothstep(0,1.5,ph);else if(ph>=18.0)fade=1-E.smoothstep(18.0,P,ph);}g.uniform1f(prog.uFade,fade);
  E.drawTri();},
 drawParticles(){},
 countParticles(){return 0;}
});
})();
(function(){
"use strict";
const A=window.__ARC,E=A.env;
const COUNT=16000;
const VS=[
'#version 300 es','precision highp float;',
'layout(location=0) in vec2 aPos; layout(location=1) in float aSpd;',
'uniform float uDPR; out float vSpd;',
'void main(){ vSpd=aSpd; gl_Position=vec4(aPos,0.,1.); gl_PointSize=(1.8+aSpd*8.0)*uDPR; }'
].join('\n');
const PFS=[
'#version 300 es','precision highp float;',
'in float vSpd; out vec4 o;',
'void main(){ vec2 d=gl_PointCoord-0.5; float r=length(d); float a=1.-smoothstep(0.0,0.5,r);',
' vec3 c=mix(vec3(0.20,0.50,1.0),vec3(0.75,0.92,1.0),clamp(vSpd*2.,0.,1.));',
' o=vec4(c*a, a*0.6); }'
].join('\n');
const BG=`#version 300 es
precision highp float;
 out vec4 o;
uniform vec2 uRes; uniform float uT, uPh;
const float PI=3.14159265;
float hh(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float nn(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(hh(i),hh(i+vec2(1,0)),f.x),mix(hh(i+vec2(0,1)),hh(i+vec2(1,1)),f.x),f.y); }
float fbm(vec2 p){ float s=0.,a=.5; for(int i=0;i<5;i++){s+=a*nn(p);p*=2.05;a*=.5;} return s; }
void main(){
  vec2 uv=((gl_FragCoord.xy/uRes)*2.-1.); uv.x*=uRes.x/uRes.y;
  float r=length(uv)+1e-4, th=atan(uv.y,uv.x);
  // 로그나선 beast 소용돌이장
  float lsp=log(r)*3.0+th*1.5-uT*2.0*uPh;
  float vortex=fbm(vec2(lsp*0.7,r*1.8))*(1.-smoothstep(0.,1.5,r))*uPh;
  // 코로나 방사선 (beast 갈기)
  float streaks=pow(max(0.5+0.5*cos(th*12.0+lsp*0.3+uT*uPh),0.),6.)
               *(1.-smoothstep(0.15,0.90,r))*uPh*0.9;
  // 내부 에너지 코어 펄스
  float core=(1.-smoothstep(0.,0.22,r))*fbm(uv*4.+uT*0.8)*uPh;
  vec3 col=vec3(0.06,0.22,0.88)*vortex
          +vec3(0.18,0.06,0.55)*streaks
          +vec3(0.3,0.65,1.0)*core*0.9;
  col=mix(vec3(dot(col,vec3(0.299,0.587,0.114))),col,1.18);
  col*=1.-0.35*dot(uv,uv);
  o=vec4(col,0.08); // 저알파: 매 프레임 소량 가산, 수십 프레임 후 수렴
}`;
const FADE=[
'#version 300 es','precision highp float;','out vec4 o; uniform float uF;',
'void main(){ o=vec4(0.,0.,0.,uF); }'
].join('\n');
const COMP=[
'#version 300 es','precision highp float;','out vec4 o; uniform vec2 uRes; uniform sampler2D uTex;',
'void main(){ o=vec4(texture(uTex, gl_FragCoord.xy/uRes).rgb, 1.); }'
].join('\n');
let pPart=null,pBG=null,pFade=null,pComp=null;
let acc=null,accT=null,fw=0,fh=0,vbo=null,pvao=null,evao=null;
const px=new Float32Array(COUNT),py=new Float32Array(COUNT),vx=new Float32Array(COUNT),vy=new Float32Array(COUNT),life=new Float32Array(COUNT),seed=new Float32Array(COUNT),buf=new Float32Array(COUNT*3);
const st={t:0,inited:false};
const SPEED=0.55;
function spawn(i){ const a=Math.random()*Math.PI*2,r=Math.random()*0.9;
  px[i]=Math.cos(a)*r; py[i]=Math.sin(a)*r; vx[i]=0; vy[i]=0; life[i]=0.5+Math.random()*0.5; seed[i]=Math.random()*1000; }
function mkacc(w,h){ const g=E.gl;
  if(acc){g.deleteFramebuffer(acc);g.deleteTexture(accT);}
  accT=g.createTexture(); g.bindTexture(g.TEXTURE_2D,accT);
  g.texImage2D(g.TEXTURE_2D,0,g.RGBA8,w,h,0,g.RGBA,g.UNSIGNED_BYTE,null);
  g.texParameteri(g.TEXTURE_2D,g.TEXTURE_MIN_FILTER,g.LINEAR); g.texParameteri(g.TEXTURE_2D,g.TEXTURE_MAG_FILTER,g.LINEAR);
  g.texParameteri(g.TEXTURE_2D,g.TEXTURE_WRAP_S,g.CLAMP_TO_EDGE); g.texParameteri(g.TEXTURE_2D,g.TEXTURE_WRAP_T,g.CLAMP_TO_EDGE);
  acc=g.createFramebuffer(); g.bindFramebuffer(g.FRAMEBUFFER,acc);
  g.framebufferTexture2D(g.FRAMEBUFFER,g.COLOR_ATTACHMENT0,g.TEXTURE_2D,accT,0);
  g.viewport(0,0,w,h); g.disable(g.BLEND); g.clearColor(0,0,0,1); g.clear(g.COLOR_BUFFER_BIT);
  g.bindFramebuffer(g.FRAMEBUFFER,null); fw=w;fh=h;
}
A.reg({
 id:'ARC-33',name:'영기 폭풍','en':'Spirit Gale Tempest',
 desc:'로그나선 영수(靈獸) 소용돌이장 위로 16,000 입자가 curl 흐름을 타고 중심으로 빨려들며 트레일을 그리는 영기 폭풍. 자체 누적 FBO(페이드+가산)로 비단결 트레일 구현. opus 포팅(입자형).',
 tech:['16k CPU Curl Particles','Self-FBO Trail Accumulation','Log-Spiral Vortex Field','Additive Motes','POINTS (no Transform Feedback)'],bloom:0.8,
 init(){ const g=E.gl;
   pPart=E.U(E.mkProg(VS,PFS,'ARC33P'),['uDPR']);
   pBG=E.U(E.mkProg(E.FS_VERT,BG,'ARC33BG'),['uRes','uT','uPh']);
   pFade=E.U(E.mkProg(E.FS_VERT,FADE,'ARC33FD'),['uF']);
   pComp=E.U(E.mkProg(E.FS_VERT,COMP,'ARC33C'),['uRes','uTex']);
   vbo=g.createBuffer(); g.bindBuffer(g.ARRAY_BUFFER,vbo); g.bufferData(g.ARRAY_BUFFER,buf.byteLength,g.DYNAMIC_DRAW);
   pvao=g.createVertexArray(); g.bindVertexArray(pvao); g.bindBuffer(g.ARRAY_BUFFER,vbo);
   g.enableVertexAttribArray(0); g.vertexAttribPointer(0,2,g.FLOAT,false,12,0);
   g.enableVertexAttribArray(1); g.vertexAttribPointer(1,1,g.FLOAT,false,12,8);
   g.bindVertexArray(null);
   evao=g.createVertexArray();
   for(let i=0;i<COUNT;i++) spawn(i);
   mkacc(E.W,E.H); st.inited=true; },
 reset(){ st.t=0; for(let i=0;i<COUNT;i++) spawn(i); if(acc)mkacc(E.W,E.H); },
 resize(w,h){ mkacc(w||E.W,h||E.H); },
 autoPoint(){ return [E.W*0.5,E.H*0.5]; },
 trigger(x,y){ st.t=0; },
 update(dt,t){
   if(!st.inited)return; st.t+=dt; const tt=st.t; const aspect=E.W/E.H;
   const p=tt%5.0; let g=0,da=0;
   const phase=E.smoothstep(0,1.2,p)*(1.-E.smoothstep(3.8,5.0,p));
   if(p<3.0)g=E.smoothstep(0,1.2,p); else if(p<3.8){g=0.3;da=E.smoothstep(0,0.4,p-3.0);}
   const cx=Math.cos(tt*0.4)*0.22, cy=Math.sin(tt*0.5)*0.16;
   for(let i=0;i<COUNT;i++){
     let x=px[i],y=py[i],nvx=vx[i],nvy=vy[i]; const xs=x*aspect;
     const fx=Math.sin(1.3*y-0.25*tt)*Math.cos(1.6*xs+0.3*tt)+0.5*Math.sin(2.1*y+0.4*tt);
     const fy=Math.sin(1.7*xs+0.2*tt)*Math.cos(1.1*y+0.3*tt);
     const tdx=cx-x,tdy=cy-y,dd=Math.hypot(tdx,tdy)+1e-3;
     const tgx=fx*SPEED+(-tdy/dd)*0.42*g+0.8*da, tgy=fy*SPEED+(tdx/dd)*0.42*g;
     nvx=nvx*0.85+tgx*0.15; nvy=nvy*0.85+tgy*0.15; x+=nvx*dt; y+=nvy*dt;
     const l=life[i]-dt*(0.30+(seed[i]%50)*0.004);
     if(l<=0||x<-1.25||x>1.25||y<-1.25||y>1.25){ spawn(i); }
     else { px[i]=x;py[i]=y;vx[i]=nvx;vy[i]=nvy;life[i]=l; }
     const b=i*3; buf[b]=px[i]; buf[b+1]=py[i]; buf[b+2]=Math.hypot(vx[i],vy[i]);
   }
   st._phase=E.clamp(phase,0,1);
 },
 drawField(t){ if(!pPart||!pPart.p)return; const g=E.gl;
   if(fw!==E.W||fh!==E.H) mkacc(E.W,E.H);
   const tgt=g.getParameter(g.FRAMEBUFFER_BINDING);
   g.bindBuffer(g.ARRAY_BUFFER,vbo); g.bufferSubData(g.ARRAY_BUFFER,0,buf);
   // accumulate into persistent FBO (no clear)
   g.bindFramebuffer(g.FRAMEBUFFER,acc); g.viewport(0,0,E.W,E.H); g.enable(g.BLEND);
   g.bindVertexArray(evao);
   g.blendFunc(g.SRC_ALPHA,g.ONE_MINUS_SRC_ALPHA);
   g.useProgram(pFade.p); g.uniform1f(pFade.uF,0.10); g.drawArrays(g.TRIANGLES,0,3);
   g.blendFunc(g.SRC_ALPHA,g.ONE);
   g.useProgram(pBG.p); g.uniform2f(pBG.uRes,E.W,E.H); g.uniform1f(pBG.uT,st.t); g.uniform1f(pBG.uPh,st._phase||0); g.drawArrays(g.TRIANGLES,0,3);
   g.useProgram(pPart.p); g.uniform1f(pPart.uDPR,(E.SC||1)); g.bindVertexArray(pvao); g.drawArrays(g.POINTS,0,COUNT);
   // composite acc -> ARC scene (opaque base)
   g.bindFramebuffer(g.FRAMEBUFFER,tgt); g.viewport(0,0,E.W,E.H); g.disable(g.BLEND);
   g.bindVertexArray(evao); g.activeTexture(g.TEXTURE0); g.bindTexture(g.TEXTURE_2D,accT);
   g.useProgram(pComp.p); g.uniform2f(pComp.uRes,E.W,E.H); g.uniform1i(pComp.uTex,0); g.drawArrays(g.TRIANGLES,0,3);
   g.bindVertexArray(null);
 },
 drawParticles(){}, countParticles(){ return COUNT; }
});
})();
(function(){
"use strict";
const A=window.__ARC,E=A.env;
const FS=[
'#version 300 es',
'precision highp float;',
'uniform vec2 uRes,uC;uniform float uTime,uSuck,uSing,uDome,uDomeA;',
'out vec4 o;',
E.NOISE,
'void main(){',
' float mn=min(uRes.x,uRes.y);',
' vec2 uv=(gl_FragCoord.xy-uC)/mn;',
' float d=length(uv);',
' vec2 nd=uv/max(d,1e-4);',
' vec3 col=vec3(.012,.005,.028);',
' float nb=fbm2(uv*2.0+vec2(uTime*.025,0.));',
' col+=vec3(.07,.02,.14)*nb*nb;',
' if(uSuck>0.001){',
'  float aR=d*7.-uTime*3.;',
'  float ca=cos(aR),sa=sin(aR);',
'  vec2 rp=mat2(ca,-sa,sa,ca)*uv;',
'  float sw=fbm2(rp*4.5);',
'  float streak=smoothstep(.55,.85,sw)*(1.-smoothstep(.08,1.0,d))*uSuck;',
'  col+=vec3(.45,.18,.95)*streak*1.3;',
'  float ring=exp(-pow((d-.07)*26.,2.));',
'  col+=vec3(.9,.4,1.6)*ring*uSing*2.;',
'  col=mix(col,vec3(.005,0.,.01),uSing*(1.-smoothstep(0.,.06,d)));',
' }',
' if(uDome>0.001){',
'  float jag=fbm2(nd*2.8+vec2(uTime*.7,0.))-.5;',
'  float edge=uDome*(1.+.28*jag);',
'  float rim=exp(-pow((d-edge)*16.,2.));',
'  float fill=(1.-smoothstep(edge*.45,max(edge,1e-3),d))*.22;',
'  float fil=smoothstep(.6,.92,fbm2(nd*3.5+vec2(0.,uTime*1.6)+vec2(d*4.)));',
'  fil*=(1.-smoothstep(edge*.55,max(edge*1.04,1e-3),d))*smoothstep(edge*.15,max(edge*.6,1e-3),d);',
'  col+=(vec3(.4,.12,.95)*fill+vec3(1.,.55,1.8)*rim*2.0+vec3(.75,.3,1.6)*fil*1.3)*uDomeA;',
' }',
' o=vec4(col,1.);',
'}'
].join('\n');
const glow=new E.Pool(3072);
let prog=null;
const st={phase:0,timer:0,cx:0,cy:0,R0:1,uSuck:0,uSing:0,dome:0,domeA:0,acc:0,boltT:0};
function suckFn(p,i,dt){
 if(p.seed[i]<0.5)return;
 const dx=st.cx-p.px[i],dy=st.cy-p.py[i];
 const dist=Math.hypot(dx,dy)||1;
 if(dist<18*E.SC){p.life[i]=0.0001;return;}
 const acc=(600+3200*E.clamp(1-dist/st.R0,0,1))*E.SC;
 p.vx[i]+=dx/dist*acc*dt;
 p.vy[i]+=dy/dist*acc*dt;
}
function bolt(x0,y0,ang,len){
 const nodes=15;
 let x=x0,y=y0,a=ang;
 for(let i=0;i<nodes;i++){
  const step=len/nodes;
  a+=E.rnd(-0.55,0.55);
  x+=Math.cos(a)*step;y+=Math.sin(a)*step;
  glow.spawn(x,y,E.rnd(-25,25),E.rnd(-25,25),
   E.rnd(.14,.3),E.rnd(4,11)*E.SC,.85,.5,1.6,.95,0,{drag:4,seed:0.1});
 }
}
function burst(){
 E.flashAdd(1,.85,.6,1);E.shakeAdd(22*E.SC);E.setCA(0.01);
 st.phase=2;st.timer=0;
 for(let i=0;i<300;i++){
  const a=Math.random()*E.TAU;
  const sp=E.rnd(550,1700)*E.SC;
  const m=Math.random();
  glow.spawn(st.cx,st.cy,Math.cos(a)*sp,Math.sin(a)*sp,
   E.rnd(.7,1.4),E.rnd(7,26)*E.SC,
   .45+.6*m,.15+.3*m,1.1+.6*m,E.rnd(.6,.95),0,{drag:2.6,seed:0.1});
 }
 for(let i=0;i<9;i++)bolt(st.cx,st.cy,Math.random()*E.TAU,st.R0*E.rnd(.55,.85));
}
A.reg({
 id:'FX-89',name:'보랏빛 공허 폭발',en:'Violet Void Burst',
 desc:'구심 흡인(나선 가속) → 특이점 압축 → 들쭉한 자색 에너지 돔이 감속 팽창. 돔 가장자리 = 방향벡터 fbm(각도 이음새 0).',
 tech:['Centripetal Suction','Singularity Collapse','Procedural Jagged Dome','Lightning Bolt Chains','Delta-time Transition'],
 bloom:1.05,
 init(){
  prog=E.U(E.mkProg(E.FS_VERT,FS,'FX89'),['uRes','uC','uTime','uSuck','uSing','uDome','uDomeA']);
 },
 reset(){
  glow.clear();
  st.phase=0;st.timer=0;st.uSuck=0;st.uSing=0;st.dome=0;st.domeA=0;st.acc=0;st.boltT=0;
  st.cx=E.W*0.5;st.cy=E.H*0.5;
 },
 autoPoint(){return [E.W*0.5,E.H*0.52];},
 trigger(x,y){
  if(st.phase!==0)return;
  st.phase=1;st.timer=0;st.cx=x;st.cy=y;
  st.R0=Math.min(E.W,E.H)*0.52;
 },
 update(dt,t){
  st.timer+=dt;
  if(st.phase===0){
   st.acc+=dt*7;
   while(st.acc>1){
    st.acc--;
    const a=Math.random()*E.TAU,r=E.rnd(.1,.6)*Math.min(E.W,E.H);
    glow.spawn(E.W*0.5+Math.cos(a)*r,E.H*0.5+Math.sin(a)*r,
     E.rnd(-15,15),E.rnd(-15,15),E.rnd(2,4),E.rnd(3,8)*E.SC,
     .4,.18,.8,E.rnd(.2,.45),0,{seed:0.1});
   }
   st.uSuck=Math.max(0,st.uSuck-dt*2);
   st.uSing=Math.max(0,st.uSing-dt*2);
  }else if(st.phase===1){
   const u=st.timer/1.15;
   st.uSuck=E.smoothstep(0,0.3,u);
   st.uSing=E.smoothstep(0.25,0.95,u);
   st.acc+=dt*150;
   while(st.acc>1){
    st.acc--;
    const a=Math.random()*E.TAU;
    const r=st.R0*E.rnd(.55,1.0);
    const px=st.cx+Math.cos(a)*r,py=st.cy+Math.sin(a)*r;
    const tx=-Math.sin(a),ty=Math.cos(a);
    const sp=E.rnd(180,460)*E.SC;
    glow.spawn(px,py,tx*sp,ty*sp,E.rnd(1.2,2),E.rnd(4,13)*E.SC,
     .55,.25,1.2,E.rnd(.5,.9),0,{drag:.2,seed:0.9});
   }
   st.boltT-=dt;
   if(st.boltT<=0&&u>0.35){
    st.boltT=E.rnd(0.08,0.2);
    const a=Math.random()*E.TAU;
    bolt(st.cx+Math.cos(a)*st.R0*0.5,st.cy+Math.sin(a)*st.R0*0.5,a+Math.PI,st.R0*0.45);
   }
   if(u>=1)burst();
  }else{
   const u=st.timer/1.35;
   st.uSuck=Math.max(0,st.uSuck-dt*5);
   st.uSing=Math.max(0,st.uSing-dt*5);
   st.dome=E.easeOutQuart(E.clamp(u,0,1))*0.62;
   st.domeA=1-E.smoothstep(0.6,1.05,u);
   if(u>1.25){st.phase=0;st.timer=0;st.dome=0;st.domeA=0;}
  }
  glow.update(dt,t,st.phase===1?suckFn:null);
 },
 drawField(t){
  if(!prog||!prog.p)return;
  const g=E.gl;
  g.useProgram(prog.p);
  g.uniform2f(prog.uRes,E.W,E.H);
  g.uniform2f(prog.uC,st.cx||E.W*0.5,st.cy||E.H*0.5);
  g.uniform1f(prog.uTime,t);
  g.uniform1f(prog.uSuck,st.uSuck);
  g.uniform1f(prog.uSing,st.uSing);
  g.uniform1f(prog.uDome,st.dome);
  g.uniform1f(prog.uDomeA,st.domeA);
  E.drawTri();
 },
 drawParticles(){E.drawPool(glow,E.ADD());},
 countParticles(){return glow.n;}
});
})();
(function(){
"use strict";
const A=window.__ARC,E=A.env;
const FS=[
'#version 300 es',
'precision highp float;',
'uniform vec2 uRes,uHit;uniform float uTime,uRing,uGlow;',
'out vec4 o;',
E.NOISE,
'void main(){',
' float mn=min(uRes.x,uRes.y);',
' vec2 sq=(gl_FragCoord.xy-uRes*.5)/mn;',
' vec3 col=mix(vec3(.05,.018,.03),vec3(.012,.005,.018),clamp(sq.y+.6,0.,1.));',
' float nb=fbm2(sq*2.+vec2(uTime*.03,uTime*.01));',
' col+=vec3(.12,.04,.05)*nb*nb;',
' float mote=n2(sq*34.+vec2(uTime*.25,uTime*.6));',
' col+=vec3(.6,.25,.1)*smoothstep(.94,1.,mote)*.35;',
' if(uRing>0.001){',
'  vec2 hv=(gl_FragCoord.xy-uHit)/mn;',
'  hv.y*=1.8;',
'  float dd=length(hv);',
'  float rr=uRing*1.05;',
'  col+=vec3(1.4,.6,.18)*exp(-pow((dd-rr)*11.,2.))*(1.-uRing)*2.2;',
'  col+=vec3(1.2,.35,.6)*exp(-pow((dd-rr*.62)*15.,2.))*(1.-uRing)*1.2;',
' }',
' if(uGlow>0.001){',
'  vec2 hv2=(gl_FragCoord.xy-uHit)/mn;',
'  col+=vec3(1.35,.55,.22)*uGlow*exp(-length(hv2)*3.4);',
' }',
' o=vec4(col,1.);',
'}'
].join('\n');
const fire=new E.Pool(3072);
const feather=new E.Pool(512);
const smoke=new E.Pool(512);
let prog=null;
const st={phase:0,timer:0,hx:0,hy:0,uRing:0,uGlow:0,acc:0,acc2:0,
 A:[0,0],B:[0,0],C:[0,0],D:[0,0]};
function quad(p0,p1,p2,u){
 const w=1-u;
 return [w*w*p0[0]+2*w*u*p1[0]+u*u*p2[0],
         w*w*p0[1]+2*w*u*p1[1]+u*u*p2[1]];
}
const T1=1.25,T2=0.34;
function pathPos(tm){
 if(tm<T1){
  const u=tm/T1,ue=u*u*(3-2*u);
  return quad(st.A,st.B,st.C,ue);
 }
 const u=E.clamp((tm-T1)/T2,0,1),ue=u*u;
 return quad(st.C,st.D,[st.hx,st.hy],ue);
}
function curlFn(p,i,dt,t){
 if(p.seed[i]<0.5)return;
 const c=E.curl2(p.px[i]*0.006,p.py[i]*0.006,t*0.5);
 p.vx[i]+=c[0]*420*dt*E.SC;
 p.vy[i]+=c[1]*420*dt*E.SC;
}
function featherFn(p,i,dt,t){
 const term=-95*E.SC;
 p.vy[i]+=(term-p.vy[i])*Math.min(1,2.0*dt);
 p.vx[i]+=Math.sin(t*3+p.seed[i]*9)*260*dt*E.SC;
 p.rot[i]=p.seed[i]*E.TAU+Math.sin(t*2.3+p.seed[i]*13)*0.85;
}
function impact(){
 st.phase=2;st.timer=0;st.uGlow=1;
 E.flashAdd(0.9,1,.6,.3);E.shakeAdd(18*E.SC);E.setCA(0.008);
 for(let i=0;i<230;i++){
  const a=Math.random()*E.TAU;
  const sp=E.rnd(240,1000)*E.SC;
  const m=Math.random();
  feather.spawn(st.hx,st.hy,Math.cos(a)*sp,Math.sin(a)*sp*1.15+120*E.SC,
   E.rnd(2.2,3.6),E.rnd(15,42)*E.SC,
   1.15-m*0.1,.55-m*.3,.18+m*.55,E.rnd(.7,.95),1,
   {drag:1.7,seed:Math.random()});
 }
 for(let i=0;i<140;i++){
  const a=Math.random()*E.TAU;
  const sp=E.rnd(400,1400)*E.SC;
  fire.spawn(st.hx,st.hy,Math.cos(a)*sp,Math.sin(a)*sp,
   E.rnd(.35,.8),E.rnd(4,12)*E.SC,1.4,.9,.4,.95,0,{drag:2.4,seed:0.1});
 }
 for(let i=0;i<50;i++){
  const a=Math.random()*E.TAU;
  smoke.spawn(st.hx,st.hy,Math.cos(a)*E.rnd(40,200)*E.SC,E.rnd(30,160)*E.SC,
   E.rnd(1.4,2.6),E.rnd(60,150)*E.SC,.12,.05,.05,E.rnd(.3,.5),3,
   {drag:.9,grav:50*E.SC,rot:Math.random()*E.TAU,rv:E.rnd(-.6,.6)});
 }
}
A.reg({
 id:'FX-92',name:'불사조 강하',en:'Phoenix Dive Strike',
 desc:'curl-noise 화염 궤적이 활공→급강하 비행체 형성, 착탄 시 공기저항 깃털 230장 산개·낙하. 날갯짓 = 사인 진폭 양측 방출기.',
 tech:['CPU Curl Noise Field','Bezier Flight Path','Feather Sprite + Air Drag','Wing-flap Emitters','Impact Ring + Bloom'],
 bloom:1.0,
 init(){
  prog=E.U(E.mkProg(E.FS_VERT,FS,'FX92'),['uRes','uHit','uTime','uRing','uGlow']);
 },
 reset(){
  fire.clear();feather.clear();smoke.clear();
  st.phase=0;st.timer=0;st.uRing=0;st.uGlow=0;st.acc=0;st.acc2=0;
  st.hx=E.W*0.5;st.hy=E.H*0.35;
 },
 autoPoint(){return [E.W*0.5,E.H*0.33];},
 trigger(x,y){
  if(st.phase!==0)return;
  st.phase=1;st.timer=0;
  st.hx=x;st.hy=Math.min(y,E.H*0.55);
  const side=Math.random()<0.5?-1:1;
  st.A=[E.W*0.5-side*E.W*0.75,E.H*0.55];
  st.B=[E.W*0.5-side*E.W*0.25,E.H*1.08];
  st.C=[E.W*0.5+side*E.W*0.20,E.H*0.92];
  st.D=[st.hx+side*E.W*0.16,E.H*0.72];
 },
 update(dt,t){
  st.timer+=dt;
  if(st.phase===0){
   st.acc+=dt*9;
   while(st.acc>1){
    st.acc--;
    fire.spawn(E.rnd(0,E.W),E.rnd(0,E.H*0.5),E.rnd(-12,12),E.rnd(8,30),
     E.rnd(2,4),E.rnd(2,6)*E.SC,.9,.4,.12,E.rnd(.15,.4),0,{seed:0.1});
   }
   st.uRing=Math.max(0,st.uRing-dt);
   st.uGlow=Math.max(0,st.uGlow-dt);
  }else if(st.phase===1){
   const pt=pathPos(st.timer);
   const pt2=pathPos(Math.min(st.timer+0.012,T1+T2));
   let tx=pt2[0]-pt[0],ty=pt2[1]-pt[1];
   const tl=Math.hypot(tx,ty)||1;tx/=tl;ty/=tl;
   const nx=-ty,ny=tx;
   const flap=Math.sin(st.timer*11);
   const span=(46+86*Math.abs(flap))*E.SC;
   st.acc+=dt*260;
   while(st.acc>1){
    st.acc--;
    const j=E.rnd(-7,7)*E.SC;
    fire.spawn(pt[0]+nx*j,pt[1]+ny*j,
     -tx*E.rnd(40,170)*E.SC+E.rnd(-30,30),-ty*E.rnd(40,170)*E.SC+E.rnd(-30,30),
     E.rnd(.4,.8),E.rnd(9,24)*E.SC,1.35,.85,.35,E.rnd(.6,.95),0,
     {drag:2.1,seed:0.9});
   }
   st.acc2+=dt*170;
   while(st.acc2>1){
    st.acc2--;
    const s=Math.random()<0.5?1:-1;
    const off=span*flap*s;
    const m=Math.random();
    fire.spawn(pt[0]+nx*off,pt[1]+ny*off,
     -tx*E.rnd(30,120)*E.SC+nx*s*E.rnd(20,90)*E.SC,
     -ty*E.rnd(30,120)*E.SC+ny*s*E.rnd(20,90)*E.SC,
     E.rnd(.5,1.0),E.rnd(7,18)*E.SC,
     1.2-m*.2,.35+m*.25,.25+m*.65,E.rnd(.5,.85),0,
     {drag:1.6,seed:0.9});
   }
   if(st.timer>=T1+T2)impact();
  }else{
   st.uRing=E.easeOutCubic(Math.min(1,st.timer/0.8));
   st.uGlow=Math.max(0,1-st.timer/1.2);
   if(st.timer>3.4){st.phase=0;st.timer=0;st.uRing=0;}
  }
  fire.update(dt,t,curlFn);
  feather.update(dt,t,featherFn);
  smoke.update(dt,t,null);
 },
 drawField(t){
  if(!prog||!prog.p)return;
  const g=E.gl;
  g.useProgram(prog.p);
  g.uniform2f(prog.uRes,E.W,E.H);
  g.uniform2f(prog.uHit,st.hx||E.W*0.5,st.hy||E.H*0.35);
  g.uniform1f(prog.uTime,t);
  g.uniform1f(prog.uRing,st.uRing);
  g.uniform1f(prog.uGlow,st.uGlow);
  E.drawTri();
 },
 drawParticles(){
  E.drawPool(fire,E.ADD());
  E.drawPool(feather,E.ADD());
  E.drawPool(smoke,E.ALPHA());
 },
 countParticles(){return fire.n+feather.n+smoke.n;}
});
})();
(function(){
"use strict";
const A=window.__ARC,E=A.env;
const FS=[
'#version 300 es',
'precision highp float;',
'uniform vec2 uRes,uC;uniform float uTime,uBloom,uRoseA;',
'out vec4 o;',
E.NOISE,
'void main(){',
' float mn=min(uRes.x,uRes.y);',
' vec2 uv=(gl_FragCoord.xy-uC)/mn;',
' float d=length(uv);',
' float ang=atan(uv.y,uv.x);',
' vec3 col=vec3(.022,.004,.01);',
' float nb=fbm2(uv*2.1+vec2(0.,uTime*.02));',
' col+=vec3(.11,.012,.03)*nb*nb;',
' if(uRoseA>0.001&&uBloom>0.01){',
'  float sw=uTime*.35;',
'  float p1=.62+.38*abs(cos(ang*2.5+sw));',
'  float p2=.6+.4*abs(cos(ang*5.-sw*1.6+1.3));',
'  float p3=.58+.42*abs(cos(ang*1.5-sw*.7+.6));',
'  float r1=uBloom*.36*p1;',
'  float r2=uBloom*.225*p2;',
'  float r3=uBloom*.44*p3;',
'  float tex=.55+.55*fbm2(uv*7.+vec2(sw,0.));',
'  float f3=(1.-smoothstep(r3*.55,max(r3,1e-3),d));',
'  float f1=(1.-smoothstep(r1*.45,max(r1,1e-3),d));',
'  float f2=(1.-smoothstep(r2*.4,max(r2,1e-3),d));',
'  float rim1=exp(-pow((d-r1)*42.,2.));',
'  float rim2=exp(-pow((d-r2)*58.,2.));',
'  float rim3=exp(-pow((d-r3)*34.,2.));',
'  vec3 rc=vec3(.28,.015,.06)*f3*tex;',
'  rc+=vec3(.6,.045,.11)*f1*tex;',
'  rc+=vec3(.95,.11,.19)*f2*tex;',
'  rc+=vec3(1.,.18,.26)*rim3*.55;',
'  rc+=vec3(1.25,.26,.3)*rim1*.95;',
'  rc+=vec3(1.45,.42,.46)*rim2*.75;',
'  rc=mix(rc,vec3(.05,0.,.02),1.-smoothstep(0.,uBloom*.05+1e-3,d));',
'  rc+=vec3(1.5,.7,.6)*exp(-d*30./max(uBloom,.2))*.5;',
'  col+=rc*uRoseA;',
' }',
' o=vec4(col,1.);',
'}'
].join('\n');
const petal=new E.Pool(1024);
const ember=new E.Pool(512);
const smoke=new E.Pool(128);
let prog=null;
const st={phase:0,timer:0,cx:0,cy:0,bloom:0.16,roseA:1};
function petalFn(p,i,dt,t){
 const term=-110*E.SC;
 p.vy[i]+=(term-p.vy[i])*Math.min(1,1.8*dt);
 p.vx[i]+=Math.sin(t*3.2+p.seed[i]*11)*300*dt*E.SC;
 p.rot[i]=p.seed[i]*E.TAU+Math.sin(t*2.6+p.seed[i]*15)*0.95;
}
function detonate(){
 st.phase=3;st.timer=0;st.roseA=0;
 E.flashAdd(1,1,.35,.3);E.shakeAdd(24*E.SC);E.setCA(0.012);
 for(let i=0;i<900;i++){
  const a=Math.random()*E.TAU;
  const sp=E.rnd(280,1450)*E.SC;
  const m=Math.random();
  let r,g,b;
  if(m<0.7){r=E.rnd(.7,1.);g=.07;b=E.rnd(.1,.16);}
  else if(m<0.9){r=E.rnd(.3,.45);g=.035;b=.06;}
  else{r=1.25;g=.32;b=.32;}
  petal.spawn(st.cx,st.cy,Math.cos(a)*sp,Math.sin(a)*sp*1.05,
   E.rnd(1.8,3.4),E.rnd(9,30)*E.SC,r,g,b,E.rnd(.7,.95),1,
   {drag:1.6,seed:Math.random()});
 }
 for(let i=0;i<200;i++){
  const a=Math.random()*E.TAU;
  const sp=E.rnd(500,1700)*E.SC;
  ember.spawn(st.cx,st.cy,Math.cos(a)*sp,Math.sin(a)*sp,
   E.rnd(.3,.7),E.rnd(3,9)*E.SC,1.4,.5,.4,.95,0,{drag:2.6});
 }
 for(let i=0;i<55;i++){
  const a=Math.random()*E.TAU;
  smoke.spawn(st.cx,st.cy,Math.cos(a)*E.rnd(50,220)*E.SC,Math.sin(a)*E.rnd(50,220)*E.SC,
   E.rnd(1.4,2.6),E.rnd(60,150)*E.SC,.12,.02,.04,E.rnd(.3,.5),3,
   {drag:.9,grav:45*E.SC,rot:Math.random()*E.TAU,rv:E.rnd(-.5,.5)});
 }
}
A.reg({
 id:'FX-101',name:'진홍 장미 폭렬',en:'Crimson Rose Detonation',
 desc:'극좌표 3중 화판(rose curve)이 회전 개화 → 일순 정적 → 면도날 꽃잎 900장 폭산. 꽃잎 = 바람저항·종단낙하·요동 회전 시뮬.',
 tech:['Polar Rose Curve x3','Rotating Bloom Easing','900 Petal Burst','Wind Resistance + Flutter','Instant Shatter + CA'],
 bloom:1.05,
 init(){
  prog=E.U(E.mkProg(E.FS_VERT,FS,'FX101'),['uRes','uC','uTime','uBloom','uRoseA']);
 },
 reset(){
  petal.clear();ember.clear();smoke.clear();
  st.phase=0;st.timer=0;st.bloom=0.16;st.roseA=1;
  st.cx=E.W*0.5;st.cy=E.H*0.5;
 },
 autoPoint(){return [E.W*0.5,E.H*0.5];},
 trigger(x,y){
  if(st.phase!==0)return;
  st.phase=1;st.timer=0;st.cx=x;st.cy=y;st.roseA=1;
 },
 update(dt,t){
  st.timer+=dt;
  if(st.phase===0){
   st.bloom=0.16+0.035*Math.sin(t*1.7);
   st.roseA=1;
  }else if(st.phase===1){
   const u=Math.min(1,st.timer/1.4);
   st.bloom=E.lerp(0.18,1,E.easeOutCubic(u));
   if(u>=1){st.phase=2;st.timer=0;}
  }else if(st.phase===2){
   st.bloom=1+0.02*Math.sin(t*22);
   E.shakeAdd(1.2*E.SC);
   if(st.timer>0.55)detonate();
  }else{
   if(st.timer>3.2){st.phase=0;st.timer=0;st.bloom=0.16;st.roseA=1;}
  }
  petal.update(dt,t,petalFn);
  ember.update(dt,t,null);
  smoke.update(dt,t,null);
 },
 drawField(t){
  if(!prog||!prog.p)return;
  const g=E.gl;
  g.useProgram(prog.p);
  g.uniform2f(prog.uRes,E.W,E.H);
  g.uniform2f(prog.uC,st.cx||E.W*0.5,st.cy||E.H*0.5);
  g.uniform1f(prog.uTime,t);
  g.uniform1f(prog.uBloom,st.bloom);
  g.uniform1f(prog.uRoseA,st.roseA);
  E.drawTri();
 },
 drawParticles(){
  E.drawPool(petal,E.ADD());
  E.drawPool(ember,E.ADD());
  E.drawPool(smoke,E.ALPHA());
 },
 countParticles(){return petal.n+ember.n+smoke.n;}
});
})();
(function(){
"use strict";
const A=window.__ARC,E=A.env;
const FS=[
'#version 300 es',
'precision highp float;',
'uniform vec2 uRes,uHit;uniform float uTime,uRip,uGlow;',
'out vec4 o;',
E.NOISE,
'void main(){',
' float mn=min(uRes.x,uRes.y);',
' vec2 sq=(gl_FragCoord.xy-uRes*.5)/mn;',
' vec3 col=mix(vec3(.005,.034,.055),vec3(.0,.008,.022),clamp(.5-sq.y,0.,1.));',
' float sh=fbm2(vec2(sq.x*3.+sq.y*.6,uTime*.06));',
' col+=vec3(.05,.14,.18)*smoothstep(.55,.95,sh)*clamp(sq.y+.6,0.,1.)*.6;',
' float m=n2(sq*40.+vec2(uTime*.1,uTime*.05));',
' col+=vec3(.2,.5,.6)*smoothstep(.95,1.,m)*.3;',
' float nb=fbm2(sq*1.8+vec2(uTime*.03,0.));',
' col+=vec3(.012,.05,.07)*nb*nb;',
' if(uRip>0.001){',
'  vec2 hv=(gl_FragCoord.xy-uHit)/mn;',
'  hv.y*=2.2;',
'  float dd=length(hv);',
'  for(int k=0;k<3;k++){',
'   float fk=float(k);',
'   float rr=uRip*1.1-fk*.17;',
'   if(rr>0.){',
'    col+=vec3(.4,.95,1.15)*exp(-pow((dd-rr)*14.,2.))*(1.-uRip)*(1.3-.3*fk);',
'   }',
'  }',
' }',
' if(uGlow>0.001){',
'  vec2 hv2=(gl_FragCoord.xy-uHit)/mn;',
'  col+=vec3(.3,.85,1.05)*uGlow*exp(-length(hv2)*3.2);',
' }',
' o=vec4(col,1.);',
'}'
].join('\n');
const water=new E.Pool(3072);
const foam=new E.Pool(1024);
const mist=new E.Pool(256);
let prog=null;
const st={phase:0,timer:0,hx:0,hy:0,uRip:0,uGlow:0,acc:0,acc2:0,acc3:0,
 A:[0,0],B:[0,0],C:[0,0],D:[0,0]};
function quad(p0,p1,p2,u){
 const w=1-u;
 return [w*w*p0[0]+2*w*u*p1[0]+u*u*p2[0],
         w*w*p0[1]+2*w*u*p1[1]+u*u*p2[1]];
}
const T1=1.6,T2=0.42;
function pathPos(tm){
 if(tm<T1){
  const u=tm/T1,ue=u*u*(3-2*u);
  return quad(st.A,st.B,st.C,ue);
 }
 const u=E.clamp((tm-T1)/T2,0,1),ue=u*u;
 return quad(st.C,st.D,[st.hx,st.hy],ue);
}
function curlFn(p,i,dt,t){
 if(p.seed[i]<0.5)return;
 const c=E.curl2(p.px[i]*0.005,p.py[i]*0.005,t*0.4);
 p.vx[i]+=c[0]*260*dt*E.SC;
 p.vy[i]+=c[1]*260*dt*E.SC;
}
function impact(){
 st.phase=2;st.timer=0;st.uGlow=1;
 E.flashAdd(0.7,.6,.9,1.1);E.shakeAdd(16*E.SC);E.setCA(0.007);
 for(let i=0;i<260;i++){
  const m=Math.random();
  water.spawn(st.hx+E.rnd(-30,30)*E.SC,st.hy,
   E.rnd(-640,640)*E.SC,E.rnd(380,1500)*E.SC,
   E.rnd(.7,1.5),E.rnd(4,13)*E.SC,
   .35+m*.6,.8+m*.4,1.+m*.3,E.rnd(.6,.95),0,
   {drag:.5,grav:-2300*E.SC,seed:0.1});
 }
 for(let i=0;i<120;i++){
  foam.spawn(st.hx+E.rnd(-40,40)*E.SC,st.hy,
   E.rnd(-420,420)*E.SC,E.rnd(250,1000)*E.SC,
   E.rnd(.5,1.1),E.rnd(2,6)*E.SC,1.05,1.2,1.3,.95,0,
   {drag:.6,grav:-2100*E.SC,seed:0.1});
 }
 for(let i=0;i<40;i++){
  mist.spawn(st.hx+E.rnd(-60,60)*E.SC,st.hy+E.rnd(0,30)*E.SC,
   E.rnd(-130,130)*E.SC,E.rnd(30,140)*E.SC,
   E.rnd(1.8,3.2),E.rnd(60,140)*E.SC,.5,.72,.82,E.rnd(.12,.26),3,
   {drag:.6,rot:Math.random()*E.TAU,rv:E.rnd(-.4,.4)});
 }
}
A.reg({
 id:'FX-103',name:'해룡 격류',en:'Hydro-Leviathan Surge',
 desc:'수만 물입자가 사행 곡선을 따라 거대 해룡 실루엣을 이루며 활강, 수면 강타 시 3중 타원 파문 + 물기둥 분수 + 포말 산개. 순수 입자 추상형(모델 0).',
 tech:['Serpentine Undulation Path','Curl-drift Water Body','Triple Elliptic Ripples','Splash Fountain + Foam','Pure Particle Abstraction'],
 bloom:0.9,
 init(){
  prog=E.U(E.mkProg(E.FS_VERT,FS,'FX103'),['uRes','uHit','uTime','uRip','uGlow']);
 },
 reset(){
  water.clear();foam.clear();mist.clear();
  st.phase=0;st.timer=0;st.uRip=0;st.uGlow=0;st.acc=0;st.acc2=0;st.acc3=0;
  st.hx=E.W*0.5;st.hy=E.H*0.3;
 },
 autoPoint(){return [E.W*0.5,E.H*0.3];},
 trigger(x,y){
  if(st.phase!==0)return;
  st.phase=1;st.timer=0;
  st.hx=x;st.hy=Math.min(y,E.H*0.42);
  const side=Math.random()<0.5?-1:1;
  st.A=[E.W*0.5-side*E.W*0.72,E.H*1.05];
  st.B=[E.W*0.5-side*E.W*0.2,E.H*0.55];
  st.C=[E.W*0.5+side*E.W*0.24,E.H*0.86];
  st.D=[st.hx+side*E.W*0.14,E.H*0.66];
 },
 update(dt,t){
  st.timer+=dt;
  if(st.phase===0){
   st.acc3+=dt*8;
   while(st.acc3>1){
    st.acc3--;
    foam.spawn(E.rnd(0,E.W),-10,E.rnd(-10,10),E.rnd(35,90)*E.SC,
     E.rnd(4,8),E.rnd(2,5)*E.SC,.5,.85,1,E.rnd(.15,.35),0,{seed:0.1});
   }
   st.uRip=Math.max(0,st.uRip-dt);
   st.uGlow=Math.max(0,st.uGlow-dt);
  }else if(st.phase===1){
   const pt=pathPos(st.timer);
   const pt2=pathPos(Math.min(st.timer+0.012,T1+T2));
   let tx=pt2[0]-pt[0],ty=pt2[1]-pt[1];
   const tl=Math.hypot(tx,ty)||1;tx/=tl;ty/=tl;
   const nx=-ty,ny=tx;
   const und=Math.sin(st.timer*8.5)*30*E.SC;
   const hx=pt[0]+nx*und,hy=pt[1]+ny*und;
   st.acc+=dt*300;
   while(st.acc>1){
    st.acc--;
    const j=E.rnd(-24,24)*E.SC;
    const m=Math.random();
    water.spawn(hx+nx*j,hy+ny*j,
     -tx*E.rnd(30,150)*E.SC+E.rnd(-30,30),-ty*E.rnd(30,150)*E.SC+E.rnd(-30,30),
     E.rnd(.5,.95),E.rnd(7,20)*E.SC,
     .3+m*.5,.75+m*.45,1.+m*.3,E.rnd(.55,.9),0,
     {drag:1.9,seed:0.9});
   }
   st.acc2+=dt*120;
   while(st.acc2>1){
    st.acc2--;
    const j=E.rnd(-30,30)*E.SC;
    foam.spawn(hx+nx*j,hy+ny*j,
     -tx*E.rnd(20,90)*E.SC+E.rnd(-40,40),-ty*E.rnd(20,90)*E.SC+E.rnd(-40,40),
     E.rnd(.4,.8),E.rnd(2,5.5)*E.SC,1.05,1.2,1.3,E.rnd(.5,.9),0,
     {drag:1.4,seed:0.9});
   }
   if(st.timer>=T1+T2)impact();
  }else{
   st.uRip=E.easeOutCubic(Math.min(1,st.timer/1.2));
   st.uGlow=Math.max(0,1-st.timer/1.4);
   if(st.timer>3.2){st.phase=0;st.timer=0;st.uRip=0;}
  }
  water.update(dt,t,curlFn);
  foam.update(dt,t,null);
  mist.update(dt,t,null);
 },
 drawField(t){
  if(!prog||!prog.p)return;
  const g=E.gl;
  g.useProgram(prog.p);
  g.uniform2f(prog.uRes,E.W,E.H);
  g.uniform2f(prog.uHit,st.hx||E.W*0.5,st.hy||E.H*0.3);
  g.uniform1f(prog.uTime,t);
  g.uniform1f(prog.uRip,st.uRip);
  g.uniform1f(prog.uGlow,st.uGlow);
  E.drawTri();
 },
 drawParticles(){
  E.drawPool(water,E.ADD());
  E.drawPool(foam,E.ADD());
  E.drawPool(mist,E.ALPHA());
 },
 countParticles(){return water.n+foam.n+mist.n;}
});
})();
(function(){
"use strict";
const A=window.__ARC,E=A.env;
const FS=[
'#version 300 es',
'precision highp float;',
'uniform vec2 uRes,uC;uniform float uTime,uVort,uTwist,uRip,uGlow,uSuck;',
'out vec4 o;',
E.NOISE,
'void main(){',
' float mn=min(uRes.x,uRes.y);',
' vec2 sq=(gl_FragCoord.xy-uRes*.5)/mn;',
' vec3 col=mix(vec3(.012,.07,.095),vec3(.0,.018,.04),clamp(.5-sq.y,0.,1.));',
' float sh=fbm2(vec2(sq.x*3.2+sq.y*.5,uTime*.07));',
' col+=vec3(.05,.16,.19)*smoothstep(.55,.95,sh)*clamp(sq.y+.6,0.,1.)*.55;',
' float ca=fbm2(vec2(sq.x*5.,sq.y*3.-uTime*.3));',
' col+=vec3(.04,.13,.15)*smoothstep(.6,.95,ca)*clamp(-sq.y+.25,0.,1.)*.55;',
' vec2 hv=(gl_FragCoord.xy-uC)/mn;',
' if(uSuck>0.001){',
'  float dsu=length(hv);',
'  float aR=dsu*8.-uTime*4.5;',
'  float cs=cos(aR),ss=sin(aR);',
'  vec2 rp=mat2(cs,-ss,ss,cs)*hv;',
'  float sw=fbm2(rp*4.2);',
'  float streak=smoothstep(.55,.85,sw)*(1.-smoothstep(.06,1.,dsu))*uSuck;',
'  col+=vec3(.2,.8,1.)*streak*1.2;',
'  col+=vec3(.5,1.1,1.25)*exp(-dsu*9.)*uSuck*.8;',
' }',
' if(uVort>0.001&&hv.y>-.08&&hv.y<1.12){',
'  float yN=clamp(hv.y/1.04,0.,1.);',
'  float rad=(.10+.36*yN)*(1.+.05*sin(uTime*4.+yN*9.));',
'  float u=hv.x/max(rad,1e-3);',
'  float au=abs(u);',
'  if(au<1.2){',
'   float body=sqrt(max(1.-u*u,0.));',
'   float tw=uTwist*(1.+yN*1.6);',
'   float stripe=fbm2(vec2(u*1.6+tw,yN*7.-tw*.5));',
'   float edge=1.-body;',
'   float hFade=(1.-smoothstep(.82,1.04,yN))*smoothstep(0.,.05,yN+.02);',
'   vec3 wat=mix(vec3(.08,.5,.66),vec3(.5,1.,1.15),stripe);',
'   vec3 add=wat*(.3+.65*stripe)*body;',
'   add+=vec3(.9,1.2,1.3)*pow(max(edge,0.),3.)*(au<1.?1.:0.)*.9;',
'   float fm=smoothstep(.62,.9,fbm2(vec2(u*3.-tw*1.3,yN*12.)));',
'   add+=vec3(.95,1.15,1.2)*fm*body*.55;',
'   col+=add*uVort*hFade;',
'  }',
'  vec2 capv=vec2(hv.x,(hv.y-1.0)*1.8);',
'  col+=vec3(.7,1.05,1.15)*exp(-dot(capv,capv)*14.)*uVort*.7;',
' }',
' if(uRip>0.001){',
'  vec2 rv=hv;rv.y*=2.2;',
'  float dd=length(rv);',
'  for(int k=0;k<3;k++){',
'   float fk=float(k);',
'   float rr=uRip*1.05-fk*.16;',
'   if(rr>0.){',
'    col+=vec3(.4,.95,1.15)*exp(-pow((dd-rr)*15.,2.))*(1.-uRip)*(1.25-.3*fk);',
'   }',
'  }',
' }',
' col+=vec3(.3,.85,1.05)*uGlow*exp(-length(hv)*3.);',
' o=vec4(col,1.);',
'}'
].join('\n');
const spiral=new E.Pool(2048);
const colp=new E.Pool(2560);
const bub=new E.Pool(512);
const foam=new E.Pool(768);
let prog=null;
const st={phase:0,timer:0,cx:0,cy:0,vort:0,twist:0,rip:0,glow:0,suck:0,acc:0,acc2:0,acc3:0};
const fr=x=>x-Math.floor(x);
function suckFn(p,i,dt){
 const dx=st.cx-p.px[i],dy=st.cy-p.py[i];
 const dist=Math.hypot(dx,dy)||1;
 if(dist<16*E.SC){p.life[i]=0.0001;return;}
 const acc=(500+3400*E.clamp(1-dist/(Math.min(E.W,E.H)*0.55),0,1))*E.SC;
 p.vx[i]+=dx/dist*acc*dt;
 p.vy[i]+=dy/dist*acc*dt;
}
function colFn(p,i,dt,t){
 p.rv[i]=Math.min(15,p.rv[i]*(1+0.55*dt));
 const hN=1-p.life[i]/p.maxLife[i];
 const mnPx=Math.min(E.W,E.H);
 const r0=(0.05+0.30*fr(p.seed[i]*13))*mnPx;
 const rad=r0*(0.32+1.5*hN)*(1+0.07*Math.sin(t*3+p.seed[i]*21));
 const th=p.rot[i];
 const dn=Math.sin(th);
 p.px[i]=st.cx+Math.cos(th)*rad;
 p.py[i]=st.cy+hN*1.0*mnPx+dn*rad*0.16;
 p.vx[i]=0;p.vy[i]=0;
 p.size[i]=(4.5+10*fr(p.seed[i]*7))*E.SC*(0.72+0.38*(dn+1)*0.5);
 p.a[i]=(0.3+0.45*fr(p.seed[i]*3))*(0.5+0.5*(dn+1)*0.5);
}
function bubFn(p,i,dt,t){
 p.vx[i]+=Math.sin(t*5+p.seed[i]*17)*180*dt*E.SC;
}
function burst(){
 st.phase=2;st.timer=0;st.glow=1;st.rip=0;
 E.flashAdd(0.8,.55,.95,1.1);E.shakeAdd(17*E.SC);E.setCA(0.008);
 for(let i=0;i<200;i++){
  foam.spawn(st.cx+E.rnd(-26,26)*E.SC,st.cy,
   E.rnd(-560,560)*E.SC,E.rnd(320,1300)*E.SC,
   E.rnd(.6,1.2),E.rnd(2.5,7)*E.SC,1.,1.2,1.3,E.rnd(.6,.95),0,
   {drag:.6,grav:-2200*E.SC});
 }
}
A.reg({
 id:'FX-111',name:'남옥 해사 와류',en:'Aquamarine Serpent Vortex',
 desc:'수정질 물입자가 나선 흡인으로 지수 가속 → 회전 용오름으로 분출. 원기둥 깊이 시뮬(전후면 명암·크기 변조) + 패럴랙스 수막 줄무늬 + 상승 기포.',
 tech:['Cylindrical Depth Sim','Exponential Spin-up','Parallax Water Stripes','Buoyancy Bubble Field','Triple Ripple + Spray'],
 bloom:0.95,
 init(){
  prog=E.U(E.mkProg(E.FS_VERT,FS,'FX111'),['uRes','uC','uTime','uVort','uTwist','uRip','uGlow','uSuck']);
 },
 reset(){
  spiral.clear();colp.clear();bub.clear();foam.clear();
  st.phase=0;st.timer=0;st.vort=0;st.twist=0;st.rip=0;st.glow=0;st.suck=0;
  st.acc=0;st.acc2=0;st.acc3=0;
  st.cx=E.W*0.5;st.cy=E.H*0.22;
 },
 autoPoint(){return [E.W*0.5,E.H*0.3];},
 trigger(x,y){
  if(st.phase!==0)return;
  st.phase=1;st.timer=0;
  st.cx=x;st.cy=Math.min(y,E.H*0.38);
 },
 update(dt,t){
  st.timer+=dt;
  if(st.phase===0){
   st.acc3+=dt*8;
   while(st.acc3>1){
    st.acc3--;
    foam.spawn(E.rnd(0,E.W),-10,E.rnd(-10,10),E.rnd(30,80)*E.SC,
     E.rnd(4,8),E.rnd(2,5)*E.SC,.45,.85,1,E.rnd(.15,.35),0,{});
   }
   st.vort=Math.max(0,st.vort-dt*1.4);
   st.suck=Math.max(0,st.suck-dt*2);
   st.rip=Math.max(0,st.rip-dt);
   st.glow=Math.max(0,st.glow-dt);
  }else if(st.phase===1){
   const u=st.timer/1.25;
   st.suck=E.smoothstep(0,0.25,u);
   st.acc+=dt*180;
   while(st.acc>1){
    st.acc--;
    const a=Math.random()*E.TAU;
    const r=Math.min(E.W,E.H)*E.rnd(.3,.55);
    const px=st.cx+Math.cos(a)*r,py=st.cy+Math.sin(a)*r;
    const sp=E.rnd(200,520)*E.SC;
    spiral.spawn(px,py,-Math.sin(a)*sp,Math.cos(a)*sp,
     E.rnd(1,1.8),E.rnd(4,12)*E.SC,.3,.8,1.05,E.rnd(.5,.9),0,{drag:.2});
   }
   if(u>=1)burst();
  }else if(st.phase===2){
   const u=st.timer/3.0;
   st.vort=E.smoothstep(0,0.18,u)*(1-E.smoothstep(0.82,1,u));
   st.suck=Math.max(0,st.suck-dt*4);
   st.rip=E.easeOutCubic(Math.min(1,st.timer/1.2));
   st.glow=Math.max(0,1-st.timer/1.5);
   if(st.timer<2.3){
    st.acc+=dt*640;
    while(st.acc>1){
     st.acc--;
     colp.spawn(st.cx,st.cy,0,0,E.rnd(1.1,2.1),8,
      .4,.9,1.1,.7,0,
      {rot:Math.random()*E.TAU,rv:E.rnd(3.5,7),seed:Math.random()});
    }
    st.acc2+=dt*70;
    while(st.acc2>1){
     st.acc2--;
     const hN=Math.random();
     bub.spawn(st.cx+E.rnd(-1,1)*(0.06+0.3*hN)*Math.min(E.W,E.H),
      st.cy+hN*Math.min(E.W,E.H),
      E.rnd(-30,30),E.rnd(120,300)*E.SC,
      E.rnd(.6,1.3),E.rnd(2,5)*E.SC,.8,1.1,1.25,E.rnd(.4,.8),0,
      {drag:.3,seed:Math.random()});
    }
   }
   st.twist+=dt*(2+6.5*st.vort);
   if(u>=1){st.phase=3;st.timer=0;}
  }else{
   st.vort=Math.max(0,st.vort-dt*1.6);
   st.twist+=dt*2;
   if(st.timer>1){st.phase=0;st.timer=0;}
  }
  spiral.update(dt,t,st.phase===1?suckFn:null);
  colp.update(dt,t,colFn);
  bub.update(dt,t,bubFn);
  foam.update(dt,t,null);
 },
 drawField(t){
  if(!prog||!prog.p)return;
  const g=E.gl;
  g.useProgram(prog.p);
  g.uniform2f(prog.uRes,E.W,E.H);
  g.uniform2f(prog.uC,st.cx||E.W*0.5,st.cy||E.H*0.25);
  g.uniform1f(prog.uTime,t);
  g.uniform1f(prog.uVort,st.vort);
  g.uniform1f(prog.uTwist,st.twist);
  g.uniform1f(prog.uRip,st.rip);
  g.uniform1f(prog.uGlow,st.glow);
  g.uniform1f(prog.uSuck,st.suck);
  E.drawTri();
 },
 drawParticles(){
  E.drawPool(spiral,E.ADD());
  E.drawPool(colp,E.ADD());
  E.drawPool(bub,E.ADD());
  E.drawPool(foam,E.ADD());
 },
 countParticles(){return spiral.n+colp.n+bub.n+foam.n;}
});
})();
(function(){
"use strict";
const A=window.__ARC,E=A.env;
const FS=[
'#version 300 es','precision highp float;','#define TAU 6.2831853',
'uniform vec2 uRes,uC;uniform float uTime,uAura,uBurst,uSurge;',
'out vec4 o;',E.NOISE,
'void main(){',
' float mn=min(uRes.x,uRes.y);',
' vec2 uv=(gl_FragCoord.xy-uC)/mn;',
' float d=length(uv);',
' vec3 col=mix(vec3(.028,.022,.014),vec3(.006,.005,.010),clamp(uv.y+.5,0.,1.));',
' float nb=fbm2(uv*2.+vec2(uTime*.02,0.));col+=vec3(.05,.04,.02)*nb*nb;',
' if(uAura>0.001){',
'  float y=uv.y;',
'  float TOP=0.78;',                                  /* contained height (was ~1.08) */
'  float yN=clamp(y/TOP,0.,1.);',
'  float axis=(fbm2(vec2(uTime*.7,y*1.6))-.5)*0.12*smoothstep(-.1,1.,y);',
'  float xx=uv.x-axis;',
'  float prof=(1.-yN)*0.62+0.05;',                    /* narrower teardrop */
'  float edgeN=fbm2(vec2(xx*3.4+(xx>0.?2.3:-1.1),y*4.4-uTime*3.4));',
'  float w=prof*(0.42+0.78*edgeN);',
'  float au=abs(xx)/max(w,1e-3);',
'  float topF=1.-smoothstep(.80,1.02,yN);',
'  float flame=(1.-smoothstep(.65,1.1,au))*smoothstep(-.06,.10,y)*topF;',
'  float core=exp(-au*au*3.4)*(1.-yN*0.45)*smoothstep(-.04,.08,y);',
'  float surge=1.+0.22*sin(uTime*9.)+uSurge;',
'  vec3 c=vec3(1.1,.80,.32)*flame*(0.45+0.7*edgeN);',
'  c+=vec3(1.4,1.3,1.05)*core*surge;',
'  float tongue=smoothstep(.55,.92,fbm2(vec2(xx*5.,y*7.-uTime*4.5)));',
'  c+=vec3(1.15,1.0,.5)*tongue*flame*0.5;',
/* electric arcs that CLIMB the silhouette edge (not random flanking) */
'  float arc=0.;',
'  float edgeX=w*0.92;',                               /* arc rides just inside the flame edge */
'  for(int k=0;k<4;k++){',
'   float fk=float(k);',
'   float side=(mod(fk,2.)<.5)?1.:-1.;',
'   float climb=fract(uTime*0.9+fk*0.27);',            /* travels bottom->top */
'   float yk=climb*TOP;',
'   float band=exp(-pow((y-yk)*7.0,2.));',             /* localized spark on the edge */
'   float jit=(fbm2(vec2(y*8.+fk*9.+uTime*5.,fk))-.5)*0.05;',
'   float ad=abs(xx-(side*edgeX+jit));',
'   arc+=exp(-pow(ad/0.007,2.))*band*topF*smoothstep(-.02,.1,y);',
'  }',
'  c+=vec3(.5,.78,1.35)*arc*1.1;',
'  col+=c*uAura;',
'  col+=vec3(1.1,.85,.42)*exp(-pow((y+.02)*6.,2.))*exp(-xx*xx*7.)*uAura*0.6;',
'  col+=vec3(1.0,.7,.3)*exp(-d*3.0)*uAura*0.2;',
' }',
' if(uBurst>0.001){',
'  float rw=uBurst*0.95;',
'  col+=vec3(1.35,1.1,.6)*exp(-pow((d-rw)*10.,2.))*(1.-uBurst)*1.8;',
'  col+=vec3(1.25,1.2,1.0)*exp(-d*4.5)*(1.-uBurst)*(1.-uBurst)*1.6;',
' }',
' o=vec4(col,1.);',
'}'
].join('\n');
const aura=new E.Pool(2200);
let prog=null;
const st={phase:0,timer:0,cx:0,cy:0,auraI:0,burst:0,surge:0,acc:0,surgeAcc:0};
const fr=x=>x-Math.floor(x);
function auraFn(p,i,dt,t){
 const mn=Math.min(E.W,E.H);
 const hN=E.clamp((p.py[i]-st.cy)/(0.78*mn),0,1);   /* contained to TOP */
 const tvy=(120+330*Math.sin(Math.PI*Math.min(1,hN*1.05)))*E.SC; /* gentler updraft */
 p.vy[i]+=(tvy-p.vy[i])*Math.min(1,3.2*dt);
 const turb=(E.vnoise(p.px[i]*0.005+p.seed[i]*3,p.py[i]*0.005-t*0.9)-0.5);
 p.vx[i]+=turb*1000*dt*E.SC*(0.4+hN);
 const ax=st.cx+(fr(p.seed[i]*9)-0.5)*0.08*mn+Math.sin(t*1.4+p.seed[i]*7)*0.04*mn*hN;
 p.vx[i]+=(ax-p.px[i])*1.6*dt;
 if(p.py[i]>st.cy+0.80*mn)p.life[i]=Math.min(p.life[i],0.15); /* cull above frame */
}
A.reg({
 id:'FX-120',name:'초월 광휘 각성',en:'Ascension Light Aura',
 desc:'기(氣) 오라 — 화면을 벗어나지 않도록 높이·폭을 억제한 눈물방울 화염 실루엣(좌우 비대칭 fbm 가장자리). 전기 아크가 무작위 플랭킹이 아니라 실루엣 가장자리를 타고 아래→위로 자연스럽게 기어오르며 명멸. 백열 코어 맥동/서지, 난류 상승 기 입자(상단 컬링·GC0).',
 tech:['Contained Silhouette Height','Edge-Climbing Arcs','Asymmetric Flame Noise','Pulsing Core + Surge','Gentler Updraft + Top Cull'],
 bloom:0.9,
 init(){prog=E.U(E.mkProg(E.FS_VERT,FS,'FX120'),['uRes','uC','uTime','uAura','uBurst','uSurge']);},
 reset(){aura.clear();st.phase=0;st.timer=0;st.auraI=0;st.burst=0;st.surge=0;st.acc=0;st.surgeAcc=0;st.cx=E.W*0.5;st.cy=E.H*0.22;},
 autoPoint(){return [E.W*0.5,E.H*0.34];},
 resize(){},
 trigger(x,y){if(st.phase!==0)return;st.phase=1;st.timer=0;st.cx=x;st.cy=E.clamp(y,E.H*0.16,E.H*0.4);st.burst=0.001;
  E.flashAdd(0.85,1,.8,.55);E.shakeAdd(14*E.SC);E.setCA(0.007);
  for(let i=0;i<260;i++){const a=Math.random()*E.TAU;const sp=E.rnd(300,1100)*E.SC;const m=Math.random();
   aura.spawn(st.cx,st.cy+E.rnd(0,22)*E.SC,Math.cos(a)*sp,Math.abs(Math.sin(a))*sp*0.6+E.rnd(30,120)*E.SC,
    E.rnd(2.0,3.2),E.rnd(3,10)*E.SC,1.2,.85+m*.3,.4+m*.5,E.rnd(.5,.9),0,{drag:1.1,seed:Math.random(),rv:E.rnd(-3,3)});}},
 update(dt,t){
  st.timer+=dt;
  if(st.phase===0){st.acc+=dt*5;while(st.acc>1){st.acc--;aura.spawn(E.rnd(0,E.W),E.rnd(0,E.H*0.35),E.rnd(-8,8),E.rnd(14,40)*E.SC,E.rnd(3,6),E.rnd(2,4)*E.SC,1,.85,.5,E.rnd(.08,.2),0,{seed:Math.random()});}st.auraI=Math.max(0,st.auraI-dt*1.3);st.surge=Math.max(0,st.surge-dt*2);}
  else if(st.phase===1){st.auraI=E.smoothstep(0,0.4,st.timer);st.burst=st.burst>0?Math.min(1,st.burst+dt*2.4):0;if(st.burst>=1)st.burst=0;
   st.surgeAcc+=dt;if(st.surgeAcc>0.9){st.surgeAcc=0;st.surge=0.55;E.shakeAdd(4*E.SC);}st.surge=Math.max(0,st.surge-dt*1.6);
   if(st.timer<5.0){st.acc+=dt*240;const mn=Math.min(E.W,E.H);while(st.acc>1){st.acc--;const m=Math.random();
    aura.spawn(st.cx+E.rnd(-1,1)*0.08*mn,st.cy+E.rnd(-6,8)*E.SC,E.rnd(-26,26),E.rnd(50,130)*E.SC,E.rnd(1.4,2.6),E.rnd(2,8)*E.SC,1.15+m*.2,.8+m*.35,.35+m*.6,E.rnd(.45,.85),0,{seed:Math.random(),rv:E.rnd(-3,3)});}}
   else{st.phase=2;st.timer=0;}}
  else{st.auraI=Math.max(0,1-st.timer/0.9);st.surge=Math.max(0,st.surge-dt*2);if(st.timer>1){st.phase=0;st.timer=0;}}
  aura.update(dt,t,auraFn);
 },
 drawField(t){if(!prog||!prog.p)return;const g=E.gl;g.useProgram(prog.p);
  g.uniform2f(prog.uRes,E.W,E.H);g.uniform2f(prog.uC,st.cx||E.W*0.5,st.cy||E.H*0.22);
  g.uniform1f(prog.uTime,t);g.uniform1f(prog.uAura,st.auraI);g.uniform1f(prog.uBurst,st.burst);g.uniform1f(prog.uSurge,st.surge);E.drawTri();},
 drawParticles(){E.drawPool(aura,E.ADD());},
 countParticles(){return aura.n;}
});
})();
(function(){
"use strict";
const A=window.__ARC,E=A.env;
const FS=[
'#version 300 es',
'precision highp float;',
'uniform vec2 uRes,uC;uniform float uTime,uZone,uStut,uWipe,uTear;',
'out vec4 o;',
E.NOISE,
'void main(){',
' float mn=min(uRes.x,uRes.y);',
' vec2 sq=(gl_FragCoord.xy-uRes*.5)/mn;',
' vec2 hv=(gl_FragCoord.xy-uC)/mn;',
' vec2 gp=sq;',
' if(uStut>0.001){',
'  float band=floor((sq.y+2.)*11.);',
'  float tQ=floor(uTime*24.);',
'  float ho=fract(sin(band*12.99+tQ*78.2)*43758.5)-.5;',
'  gp.x+=ho*.13*uStut*step(.5,fract(sin(band*7.1+tQ*3.3)*135.7));',
' }',
' vec3 col=mix(vec3(.016,.018,.04),vec3(.006,.005,.016),clamp(sq.y+.5,0.,1.));',
' float nb=fbm2(gp*2.4+vec2(uTime*.04,0.));',
' col+=vec3(.05,.06,.12)*nb*nb;',
' col+=vec3(.1,.02,.12)*exp(-pow((gp.y+.3)*5.,2.))*.5;',
' float zd=length(hv);',
' float zmask=(1.-smoothstep(uZone*.7,max(uZone,1e-3),zd))*step(.001,uZone);',
' if(zmask>0.002){',
'  vec2 vp=hv*7.5;',
'  vec2 ip=floor(vp),fp2=fract(vp);',
'  float f1=9.,f2=9.;vec2 cid=vec2(0.);',
'  for(int oy=-1;oy<=1;oy++){',
'   for(int ox=-1;ox<=1;ox++){',
'    vec2 g=vec2(float(ox),float(oy));',
'    vec2 oc=ip+g;',
'    vec2 r2=fract(sin(vec2(dot(oc,vec2(127.1,311.7)),dot(oc,vec2(269.5,183.3))))*43758.5453);',
'    vec2 pt=g+r2-fp2;',
'    float dd=dot(pt,pt);',
'    if(dd<f1){f2=f1;f1=dd;cid=oc;}',
'    else if(dd<f2){f2=dd;}',
'   }',
'  }',
'  f1=sqrt(f1);f2=sqrt(f2);',
'  float edge=1.-smoothstep(0.,.07,f2-f1);',
'  float cseed=fract(sin(dot(cid,vec2(12.99,78.23))+floor(uTime*8.))*43758.5);',
'  float voidc=step(.78,cseed);',
'  float shift=step(.5,cseed)*(cseed-.5)*.22;',
'  vec2 cp=gp+vec2(shift,-shift*.6);',
'  float nb2=fbm2(cp*3.2+vec2(uTime*.05,0.));',
'  vec3 cellCol=mix(vec3(.05,.07,.17),vec3(.15,.05,.2),cseed)+vec3(.1,.12,.2)*nb2;',
'  cellCol=mix(cellCol,vec3(.004)+vec3(.05,0.,.07)*n2(hv*60.+vec2(uTime*30.,0.)),voidc);',
'  cellCol+=mix(vec3(0.,1.15,1.35),vec3(1.35,.1,1.05),step(.5,cseed))*edge*1.25;',
'  col=mix(col,cellCol,zmask);',
'  col+=vec3(.5,.12,.95)*exp(-pow((zd-uZone)*15.,2.))*.95;',
' }',
' col+=vec3(.9,.5,1.4)*uTear*exp(-zd*5.);',
' if(uWipe>0.001){',
'  float wx=mix(-1.05,1.05,uWipe);',
'  col=mix(mix(vec3(.014,.016,.034),vec3(.006,.005,.016),clamp(sq.y+.5,0.,1.)),col,smoothstep(wx,wx+.012,sq.x));',
'  col+=vec3(.2,1.2,1.3)*exp(-pow((sq.x-wx)*55.,2.))*1.5;',
' }',
' o=vec4(col,1.);',
'}'
].join('\n');
const shard=new E.Pool(640);
const mote=new E.Pool(768);
let prog=null;
const st={phase:0,timer:0,cx:0,cy:0,zone:0,stut:0,wipe:0,tear:0,
 stutT:0,stutFrames:0,acc:0};
A.reg({
 id:'FX-121',name:'양자 글리치 처형',en:'Cyber-Glitch Execution',
 desc:'국소 공간이 보로노이 파편으로 부식 — 셀별 블록 변위·미렌더 보이드·네온 경계. 1~2프레임 드롭아웃 스터터(주사선 밴딩+CA 스파이크)가 산발하다 단칼 스크린 와이프로 소거.',
 tech:['Math Voronoi F2-F1','Per-cell Block Displace','1-2 Frame Stutter Drops','Scanline Band Quantize','Hard Screen Wipe'],
 bloom:1.0,
 init(){
  prog=E.U(E.mkProg(E.FS_VERT,FS,'FX121'),['uRes','uC','uTime','uZone','uStut','uWipe','uTear']);
 },
 reset(){
  shard.clear();mote.clear();
  st.phase=0;st.timer=0;st.zone=0;st.stut=0;st.wipe=0;st.tear=0;
  st.stutT=0;st.stutFrames=0;st.acc=0;
  st.cx=E.W*0.5;st.cy=E.H*0.5;
 },
 autoPoint(){return [E.W*0.5,E.H*0.5];},
 trigger(x,y){
  if(st.phase!==0)return;
  st.phase=1;st.timer=0;st.cx=x;st.cy=y;
  st.tear=1;st.stutT=E.rnd(0.1,0.25);
  E.flashAdd(0.7,.8,.4,1.1);E.shakeAdd(16*E.SC);E.setCA(0.012);
  for(let i=0;i<160;i++){
   const a=Math.random()*E.TAU;
   const sp=E.rnd(250,1100)*E.SC;
   const mg=Math.random()<0.5;
   shard.spawn(x,y,Math.cos(a)*sp,Math.sin(a)*sp,
    E.rnd(.6,1.4),E.rnd(6,18)*E.SC,
    mg?1.2:.1,mg?.1:1.05,mg?1.:1.2,E.rnd(.6,.95),2,
    {rot:Math.random()*E.TAU,rv:E.rnd(-7,7),drag:1.8});
  }
 },
 update(dt,t){
  st.timer+=dt;
  st.tear=Math.max(0,st.tear-dt*4);
  if(st.phase===1){
   st.zone=E.easeOutBack(Math.min(1,st.timer/0.25))*0.52;
   if(st.timer>0.25){st.phase=2;st.timer=0;}
  }else if(st.phase===2){
   st.stutT-=dt;
   if(st.stutFrames>0){
    st.stut=1;st.stutFrames--;
    E.shakeAdd(5*E.SC);E.setCA(0.009);
   }else{
    st.stut=Math.max(0,st.stut-dt*18);
    if(st.stutT<=0){
     st.stutFrames=1+(Math.random()<0.5?1:0);
     st.stutT=E.rnd(0.12,0.35);
    }
   }
   st.acc+=dt*60;
   const mn=Math.min(E.W,E.H);
   while(st.acc>1){
    st.acc--;
    const a=Math.random()*E.TAU,r=E.rnd(0,0.5)*st.zone*2*mn*0.5;
    mote.spawn(st.cx+Math.cos(a)*r,st.cy+Math.sin(a)*r,
     E.rnd(-15,15),E.rnd(150,420)*E.SC,
     E.rnd(.3,.7),E.rnd(1.5,4)*E.SC,.15,1.1,1.25,E.rnd(.5,.9),0,{drag:.3});
   }
   if(st.timer>2.2){st.phase=3;st.timer=0;}
  }else if(st.phase===3){
   st.stut=0;
   st.wipe=Math.min(1,st.timer/0.28);
   if(st.wipe>=1){
    st.phase=0;st.timer=0;st.zone=0;st.wipe=0;
    E.flashAdd(0.25,.3,1,1.1);
   }
  }else{
   st.zone=Math.max(0,st.zone-dt*2);
  }
  shard.update(dt,t,null);
  mote.update(dt,t,null);
 },
 drawField(t){
  if(!prog||!prog.p)return;
  const g=E.gl;
  g.useProgram(prog.p);
  g.uniform2f(prog.uRes,E.W,E.H);
  g.uniform2f(prog.uC,st.cx||E.W*0.5,st.cy||E.H*0.5);
  g.uniform1f(prog.uTime,t);
  g.uniform1f(prog.uZone,st.zone);
  g.uniform1f(prog.uStut,st.stut);
  g.uniform1f(prog.uWipe,st.wipe);
  g.uniform1f(prog.uTear,st.tear);
  E.drawTri();
 },
 drawParticles(){
  E.drawPool(shard,E.ADD());
  E.drawPool(mote,E.ADD());
 },
 countParticles(){return shard.n+mote.n;}
});
})();
(function(){
"use strict";
const A=window.__ARC,E=A.env;
const FS=[
'#version 300 es',
'precision highp float;',
'uniform vec2 uRes,uHit;',
'uniform float uTime,uSeal,uRel,uSeed,uHeat,uBoom;',
'uniform float uAge[12];',
'out vec4 o;',
E.NOISE,
'void main(){',
' float mn=min(uRes.x,uRes.y);',
' vec2 uv=(gl_FragCoord.xy-uHit)/mn;',
' vec2 bp=uv;',
' float lat=0.;float gap=0.;',
' float relSnap=(uRel>=0.)?(1.-uRel)*cos(uRel*26.)*exp(-uRel*4.):1.;',
' for(int i=0;i<12;i++){',
'  float ag=uAge[i];',
'  if(ag>=0.){',
'   float fi=float(i);',
'   float an=uSeed*6.2832+fi*2.39996;',
'   vec2 dir=vec2(cos(an),sin(an));',
'   vec2 nv=vec2(-dir.y,dir.x);',
'   float off=(fract(sin(fi*12.9898+uSeed*78.233)*43758.5)-.5)*.15;',
'   float bend=(fract(sin(fi*7.13+uSeed*3.71)*23761.3)-.5)*.7;',
'   float s=dot(uv,dir);',
'   float dn=dot(uv,nv)-bend*s*s-off;',
'   float sh=.011*clamp(ag*2.5,0.,1.)*relSnap;',
'   bp+=nv*sign(dn)*sh;',
'   float sweep=clamp(ag/.05,0.,1.);',
'   float headS=mix(-1.,1.,sweep);',
'   float drawn=1.-smoothstep(headS,headS+.12,s);',
'   float taper=1.-smoothstep(.5,.92,abs(s));',
'   float ero=1.;',
'   if(uRel>=0.){',
'    float nz=n2(vec2(s*4.+fi*7.3,fi*13.1));',
'    ero=smoothstep(uRel*1.2,uRel*1.2+.22,nz+.1);',
'   }',
'   float w=.0036+.0009*sin(uTime*38.+fi*2.1);',
'   float lineI=exp(-dn*dn/(w*w))*drawn*taper*ero;',
'   float flare=(uRel>=0.)?(1.+7.*exp(-uRel*6.)):1.;',
'   float env=(.24+exp(-ag*7.))*flare;',
'   lat+=lineI*env;',
'   gap+=exp(-dn*dn/(w*w*.16))*drawn*taper*ero*clamp(ag*2.,0.,1.);',
'   vec2 tp=uv-dir*headS;',
'   lat+=exp(-dot(tp,tp)*900.)*(1.-sweep)*1.6;',
'  }',
' }',
' vec3 col=mix(vec3(.052,.056,.078),vec3(.016,.017,.028),clamp(uv.y+.5,0.,1.));',
' float nb=fbm2(bp*2.3+vec2(uTime*.012,0.));',
' col+=vec3(.10,.105,.135)*nb*nb;',
' col+=vec3(.17,.105,.07)*exp(-pow((bp.y+.30)*8.,2.))*.65;',
' float mote=n2(bp*30.+vec2(uTime*.04*(1.-uSeal),uTime*.1*(1.-uSeal)));',
' col+=vec3(.4,.42,.5)*smoothstep(.95,1.,mote)*.3;',
' col=mix(col,vec3(dot(col,vec3(.333)))*vec3(.55,.6,.78),uSeal*.75);',
' col*=1.-uSeal*.32*clamp(dot(uv,uv)*1.8,0.,1.);',
' col+=vec3(.85,.92,1.08)*lat*1.55;',
' float gv=clamp(gap,0.,1.);',
' col=mix(col,vec3(0.),gv*.92);',
' col+=vec3(1.15,1.2,1.4)*gv*clamp(lat,0.,1.)*.45;',
' if(uBoom>0.001){',
'  vec2 fv=vec2(uv.x,(uv.y+.30)*2.1);',
'  float fd=length(fv);',
'  float rw=uBoom*.85;',
'  col+=vec3(1.45,.65,.22)*exp(-pow((fd-rw)*12.,2.))*(1.-uBoom)*2.3;',
'  col+=vec3(1.3,.5,.2)*exp(-fd*4.)*(1.-uBoom)*(1.-uBoom)*1.8;',
'  col+=vec3(1.4,.8,.4)*exp(-uv.x*uv.x*40.)*clamp((uv.y+.3)*2.,0.,1.)*(1.-uBoom)*(1.-uBoom)*1.2;',
' }',
' if(uHeat>0.001){',
'  vec2 fv2=vec2(uv.x,(uv.y+.30)*2.2);',
'  float fd2=length(fv2);',
'  float mask=1.-smoothstep(.18,.34,fd2);',
'  col=mix(col,col*.35,mask*smoothstep(0.,.12,uHeat)*.8);',
'  float vn=smoothstep(.55,.72,fbm2(fv2*13.+vec2(2.7,8.1)));',
'  col+=vec3(1.25,.45,.12)*mask*vn*uHeat*uHeat*1.3;',
' }',
' o=vec4(col,1.);',
'}'
].join('\n');
const streak=new E.Pool(1024);
const shard=new E.Pool(768);
const ember=new E.Pool(768);
const smoke=new E.Pool(256);
let prog=null;
const st={phase:0,timer:0,hx:0,hy:0,seal:0,rel:-1,seed:0,heat:0,boom:0,
 cut:0,cutT:0,boomT:-1};
const aAge=new Float32Array(12);
function cutDir(i){
 const an=st.seed*6.2832+i*2.39996;
 return [Math.cos(an),Math.sin(an)];
}
function dustFn(p,i,dt){
 const f=1-st.seal*0.96;
 p.px[i]+=p.vx[i]*dt*(f-1);
 p.py[i]+=p.vy[i]*dt*(f-1);
}
function doCut(k){
 aAge[k]=0;
 E.shakeAdd(2.8*E.SC);
 const d=cutDir(k);
 const mn=Math.min(E.W,E.H);
 for(let j=0;j<8;j++){
  const s=E.rnd(-0.45,0.45)*mn;
  streak.spawn(st.hx+d[0]*s,st.hy+d[1]*s,
   d[0]*E.rnd(900,1900)*E.SC*(Math.random()<0.5?1:-1),
   d[1]*E.rnd(900,1900)*E.SC*(Math.random()<0.5?1:-1),
   E.rnd(.08,.18),E.rnd(2,5)*E.SC,.95,1,1.15,.9,0,{drag:4});
 }
}
function release(){
 st.phase=3;st.timer=0;st.rel=0;st.boomT=0.25;
 E.flashAdd(1,.95,.97,1.1);E.shakeAdd(22*E.SC);E.setCA(0.013);
 const mn=Math.min(E.W,E.H);
 for(let k=0;k<12;k++){
  const d=cutDir(k);
  const nx=-d[1],ny=d[0];
  for(let j=0;j<12;j++){
   const s=E.rnd(-0.4,0.4)*mn;
   const sg=Math.random()<0.5?1:-1;
   const sp=E.rnd(380,1250)*E.SC;
   shard.spawn(st.hx+d[0]*s,st.hy+d[1]*s,
    nx*sg*sp+E.rnd(-80,80),ny*sg*sp+E.rnd(-80,80),
    E.rnd(.7,1.5),E.rnd(5,15)*E.SC,
    .72,.78,.95,E.rnd(.6,.9),2,
    {rot:Math.random()*E.TAU,rv:E.rnd(-6,6),drag:1.6,grav:-700*E.SC});
  }
 }
}
function boom(){
 st.boom=0.001;st.heat=1;
 E.flashAdd(0.9,1,.6,.3);E.shakeAdd(26*E.SC);E.setCA(0.011);
 const mn=Math.min(E.W,E.H);
 const gy=st.hy-0.30*mn;
 for(let i=0;i<180;i++){
  const a=Math.PI*0.5+E.rnd(-1.5,1.5);
  const sp=E.rnd(300,1250)*E.SC;
  ember.spawn(st.hx+E.rnd(-30,30)*E.SC,gy,
   Math.cos(a)*sp,Math.sin(a)*sp,
   E.rnd(.5,1.1),E.rnd(3,9)*E.SC,1.4,.7,.25,E.rnd(.6,.95),0,
   {drag:.8,grav:-1700*E.SC});
 }
 for(let i=0;i<45;i++){
  smoke.spawn(st.hx+E.rnd(-60,60)*E.SC,gy,
   E.rnd(-90,90)*E.SC,E.rnd(40,160)*E.SC,
   E.rnd(1.4,2.6),E.rnd(50,130)*E.SC,.11,.05,.04,E.rnd(.28,.45),3,
   {drag:.8,rot:Math.random()*E.TAU,rv:E.rnd(-.5,.5)});
 }
}
A.reg({
 id:'FX-122',name:'거합 · 시공 십이참',en:'Phantom Blade Flurry — Iai Space-Sever',
 desc:'시간이 봉인(탈채도 침묵)되고 12참격이 0.055s 간격으로 공간 자체를 절개 — 절단선 양측의 세계가 실제로 어긋나 밀리고(전단 변위), 틈새엔 칠흑 진공선. 발도 해방 일순: 침식 용해(가장자리→안쪽)로 균열이 풀리며 공간이 탄성 스냅(감쇠 진동)으로 울리고, 0.25s 지연 지면 폭발이 작렬. 탄흔 잔열이 식는다.',
 tech:['Spacetime Shear Displace','Vacuum Hairline Gap','Time-Seal Desaturation','Edge-in Alpha Erosion','Elastic Snap-back Ring','Delayed Ground Burst'],
 bloom:1.05,
 init(){
  prog=E.U(E.mkProg(E.FS_VERT,FS,'FX122'),['uRes','uHit','uTime','uSeal','uRel','uSeed','uHeat','uBoom','uAge']);
 },
 reset(){
  streak.clear();shard.clear();ember.clear();smoke.clear();
  st.phase=0;st.timer=0;st.seal=0;st.rel=-1;st.heat=0;st.boom=0;
  st.cut=0;st.cutT=0;st.boomT=-1;
  aAge.fill(-1);
  st.hx=E.W*0.5;st.hy=E.H*0.52;
 },
 autoPoint(){return [E.W*0.5,E.H*0.52];},
 trigger(x,y){
  if(st.phase!==0)return;
  st.phase=1;st.timer=0;st.cut=0;st.cutT=0;
  st.seed=Math.random();
  aAge.fill(-1);
  st.hx=x;st.hy=E.clamp(y,E.H*0.35,E.H*0.7);
 },
 update(dt,t){
  st.timer+=dt;
  for(let k=0;k<12;k++)if(aAge[k]>=0)aAge[k]+=dt;
  st.heat=Math.max(0,st.heat-dt*0.2);
  if(st.boom>0)st.boom=Math.min(1,st.boom+dt*1.4);
  if(st.boom>=1)st.boom=0;
  if(st.phase===1){
   st.seal=E.smoothstep(0,0.3,st.timer);
   st.cutT-=dt;
   if(st.cutT<=0&&st.cut<12){
    doCut(st.cut);st.cut++;st.cutT=0.055;
   }
   if(st.cut>=12&&st.timer>12*0.055+0.4){st.phase=2;st.timer=0;}
  }else if(st.phase===2){
   E.shakeAdd(1.4*E.SC);
   if(st.timer>0.32)release();
  }else if(st.phase===3){
   st.rel=Math.min(1.4,st.rel+dt*2);
   st.seal=Math.max(0,st.seal-dt*3);
   if(st.boomT>0){
    st.boomT-=dt;
    if(st.boomT<=0){st.boomT=-1;boom();}
   }
   if(st.timer>3.4){
    st.phase=0;st.timer=0;st.rel=-1;aAge.fill(-1);
   }
  }else{
   st.seal=Math.max(0,st.seal-dt*2);
  }
  streak.update(dt,t,null);
  shard.update(dt,t,null);
  ember.update(dt,t,null);
  smoke.update(dt,t,st.phase===1?dustFn:null);
 },
 drawField(t){
  if(!prog||!prog.p)return;
  const g=E.gl;
  g.useProgram(prog.p);
  g.uniform2f(prog.uRes,E.W,E.H);
  g.uniform2f(prog.uHit,st.hx||E.W*0.5,st.hy||E.H*0.52);
  g.uniform1f(prog.uTime,t);
  g.uniform1f(prog.uSeal,st.seal);
  g.uniform1f(prog.uRel,st.rel);
  g.uniform1f(prog.uSeed,st.seed);
  g.uniform1f(prog.uHeat,st.heat);
  g.uniform1f(prog.uBoom,st.boom);
  g.uniform1fv(prog.uAge,aAge);
  E.drawTri();
 },
 drawParticles(){
  E.drawPool(streak,E.ADD());
  E.drawPool(shard,E.ADD());
  E.drawPool(ember,E.ADD());
  E.drawPool(smoke,E.ALPHA());
 },
 countParticles(){return streak.n+shard.n+ember.n+smoke.n;}
});
})();
(function(){
"use strict";
const A=window.__ARC,E=A.env;
const FS=[
'#version 300 es','precision highp float;',
'uniform vec2 uRes,uC;uniform float uTime,uCan,uRoot,uTreeA;',
'out vec4 o;',E.NOISE,
'void main(){',
' float mn=min(uRes.x,uRes.y);',
' vec2 uv=(gl_FragCoord.xy-uC)/mn;',
' vec2 cc=vec2(0.,.46);vec2 q=uv-cc;float cd=length(q);',
' float Rc=.33*uCan;vec2 bp=uv;float inC=0.;',
' if(Rc>0.005){inC=1.-smoothstep(Rc*.85,Rc*1.04,cd);',
'  vec2 nrm=vec2(fbm2(q*3.5+vec2(1.7,uTime*.08))-.5,fbm2(q*3.5+vec2(9.3,uTime*.06))-.5);',
'  bp+=nrm*.05*inC*uTreeA;}',
' vec3 col=mix(vec3(.012,.03,.022),vec3(.004,.01,.01),clamp(bp.y+.5,0.,1.));',
' float nb=fbm2(bp*2.2+vec2(uTime*.015,0.));col+=vec3(.02,.06,.035)*nb*nb;',
' float mote=n2(bp*30.+vec2(uTime*.1,uTime*.3));',
' col+=vec3(.35,.75,.4)*smoothstep(.95,1.,mote)*.22*uTreeA;',
' if(Rc>0.005){',
/* soft dappled crown (no hard ring) */
'  float dap=fbm2(q*5.+vec2(uTime*.1,0.));',
'  float crown=pow(1.-smoothstep(0.,max(Rc,1e-3),cd),1.5);',
'  vec3 can=vec3(.06,.26,.12)*crown+vec3(.20,.62,.30)*crown*(.4+.6*smoothstep(.4,.85,dap));',
'  col+=can*uTreeA;',
'  col+=vec3(.25,.70,.35)*exp(-pow((cd-Rc)/.12,2.))*uTreeA*0.42;',
'  col+=vec3(.35,.80,.40)*pow(crown,2.)*0.18*uTreeA;',
' }',
' if(uRoot>0.001){',
'  vec2 rv=vec2(uv.x,(uv.y+.30)*2.2);float rd2=length(rv);',
'  float mask=1.-smoothstep(uRoot*.5,max(uRoot,1e-3),rd2);',
'  float cr=abs(fbm2(rv*8.)*2.-1.);float vein=1.-smoothstep(0.,.22,cr);',
'  col+=(vec3(.08,.26,.12)*.5+vec3(.42,.85,.36)*vein)*mask*uTreeA*0.8;',
'  col+=vec3(.45,.82,.38)*exp(-pow((rd2-uRoot)/.05,2.))*uTreeA*0.5;',
' }',
' o=vec4(col,1.);',
'}'
].join('\n');
const TREE_VS=[
'#version 300 es','layout(location=0) in vec2 aPos;','layout(location=1) in vec2 aUV;','layout(location=2) in float aFade;',
'uniform vec2 uRes;','out vec2 vUV;out float vF;',
'void main(){vec2 n=aPos/uRes*2.-1.;gl_Position=vec4(n,0.,1.);vUV=aUV;vF=aFade;}'
].join('\n');
const TREE_FS=[
'#version 300 es','precision highp float;','in vec2 vUV;in float vF;','uniform float uTime;','out vec4 o;',
'void main(){',
' float v=vUV.y*2.-1.;',
' float body=1.-smoothstep(.30,1.,abs(v));',
' float core=exp(-v*v*4.5);',
' float sap=.5+.5*sin(vUV.x*6.-uTime*4.);',
' vec3 c=vec3(.05,.30,.15)*body+vec3(.28,.80,.40)*core*(.5+.5*sap);',
' c+=vec3(.5,.92,.55)*pow(core,2.)*.32;',
' o=vec4(c,(body*.55+core*.7)*vF);',
'}'
].join('\n');
const MAXB=80,SEGB=7,FPV=5;
const bx=new Float32Array(MAXB*SEGB),by=new Float32Array(MAXB*SEGB);
const bw=new Float32Array(MAXB),bt0=new Float32Array(MAXB),bph=new Float32Array(MAXB);
const verts=new Float32Array(MAXB*SEGB*2*FPV);
let nb=0;
const leaf=new E.Pool(900),fire=new E.Pool(512);
let prog=null,tprog=null,vbo=null,vao=null;
const st={phase:0,timer:0,cx:0,gy:0,g:0,can:0,root:0,treeA:1,acc:0};
function leafFn(p,i,dt,t){
 const term=-45*E.SC;
 p.vy[i]+=(term-p.vy[i])*Math.min(1,1.4*dt);
 p.vx[i]+=Math.sin(t*1.8+p.seed[i]*12)*150*dt*E.SC;
}
function rec(x,y,ang,len,w,depth,t0){
 if(nb>=MAXB||depth<0)return;
 const idx=nb++;bw[idx]=w;bt0[idx]=t0;bph[idx]=Math.random()*13;
 let a=ang,px2=x,py2=y;
 for(let i=0;i<SEGB;i++){bx[idx*SEGB+i]=px2;by[idx*SEGB+i]=py2;
  a+=E.rnd(-0.12,0.12)+(Math.PI/2-a)*0.06;
  px2+=Math.cos(a)*len/(SEGB-1);py2+=Math.sin(a)*len/(SEGB-1);}
 if(depth>0){const tx=bx[idx*SEGB+SEGB-1],ty=by[idx*SEGB+SEGB-1];
  rec(tx,ty,a+E.rnd(0.25,0.6),len*0.70,w*0.64,depth-1,t0+0.13);
  rec(tx,ty,a-E.rnd(0.25,0.6),len*0.70,w*0.64,depth-1,t0+0.13);
  if(depth>=2&&Math.random()<0.6){rec(bx[idx*SEGB+3],by[idx*SEGB+3],a+E.rnd(-.9,.9),len*0.52,w*0.52,depth-2,t0+0.2);}}
}
A.reg({
 id:'FX-124',name:'세계수 전개 방벽',en:'World Tree Aegis',
 desc:'재귀 80가지가 굵은 테이퍼 줄기로 부드럽게 성장(수액 맥동). 딱딱한 링 폐기 — 회화적 dapple 수관(fbm 명암)과 넓고 은은한 글로우 림으로 유기적 전개. 굴절 반구·저중력 부유 낙엽·뿌리 광맥, 소멸 시 반딧불 승천.',
 tech:['Recursive 80-Branch Gen','Thick Tapered Soft Ribbons','Dappled Painterly Crown','Soft Glow Rim (no hard ring)','fbm Refraction Dome','Low-grav Drifting Leaves'],
 bloom:0.85,
 init(){const g=E.gl;
  prog=E.U(E.mkProg(E.FS_VERT,FS,'FX124'),['uRes','uC','uTime','uCan','uRoot','uTreeA']);
  tprog=E.U(E.mkProg(TREE_VS,TREE_FS,'FX124t'),['uRes','uTime']);
  vbo=g.createBuffer();g.bindBuffer(g.ARRAY_BUFFER,vbo);g.bufferData(g.ARRAY_BUFFER,verts.byteLength,g.DYNAMIC_DRAW);
  vao=g.createVertexArray();g.bindVertexArray(vao);g.bindBuffer(g.ARRAY_BUFFER,vbo);
  g.enableVertexAttribArray(0);g.vertexAttribPointer(0,2,g.FLOAT,false,FPV*4,0);
  g.enableVertexAttribArray(1);g.vertexAttribPointer(1,2,g.FLOAT,false,FPV*4,8);
  g.enableVertexAttribArray(2);g.vertexAttribPointer(2,1,g.FLOAT,false,FPV*4,16);
  g.bindVertexArray(null);},
 reset(){leaf.clear();fire.clear();st.phase=0;st.timer=0;st.g=0;st.can=0;st.root=0;st.treeA=1;st.acc=0;nb=0;st.cx=E.W*0.5;st.gy=E.H*0.5-0.30*Math.min(E.W,E.H);},
 autoPoint(){return [E.W*0.5,E.H*0.5];},
 trigger(x){if(st.phase!==0)return;st.phase=1;st.timer=0;st.treeA=1;nb=0;const mn=Math.min(E.W,E.H);
  st.cx=E.clamp(x,E.W*0.3,E.W*0.7);st.gy=E.H*0.5-0.30*mn;
  rec(st.cx,st.gy,Math.PI/2,0.30*mn,28*E.SC,4,0);
  E.flashAdd(0.4,.55,.9,.55);E.shakeAdd(10*E.SC);},
 update(dt,t){
  st.timer+=dt;
  if(st.phase===0){st.g=Math.max(0,st.g-dt*2);st.can=Math.max(0,st.can-dt*2);st.root=Math.max(0,st.root-dt*2);st.treeA=1;}
  else if(st.phase===1){st.g=E.easeOutCubic(Math.min(1,st.timer/1.4))*(1+0.02*Math.sin(t*4));st.g=Math.min(st.g,1.02);
   st.root=E.easeOutCubic(Math.min(1,st.timer/1.6))*0.6;st.can=E.smoothstep(0.5,1,Math.min(1,st.timer/1.3));
   if(st.timer>1.5){st.phase=2;st.timer=0;}}
  else if(st.phase===2){st.g=1+0.012*Math.sin(t*2.6);st.acc+=dt*34;const mn=Math.min(E.W,E.H);
   while(st.acc>1){st.acc--;const a=Math.random()*E.TAU,r=E.rnd(0,0.30)*mn;const m=Math.random();
    leaf.spawn(st.cx+Math.cos(a)*r,st.gy+0.46*mn+Math.sin(a)*r*0.6,E.rnd(-26,26),E.rnd(-35,12),E.rnd(2.5,4.5),E.rnd(6,15)*E.SC,.28+m*.35,.78+m*.3,.30+m*.2,E.rnd(.4,.8),1,{drag:.9,seed:Math.random()});}
   if(st.timer>4.2){st.phase=3;st.timer=0;E.flashAdd(0.45,.65,1,.55);
    for(let i=0;i<150;i++){const a=Math.random()*E.TAU;fire.spawn(st.cx+E.rnd(-1,1)*0.26*Math.min(E.W,E.H),st.gy+E.rnd(0,0.5)*Math.min(E.W,E.H),Math.cos(a)*E.rnd(18,80),E.rnd(55,200)*E.SC,E.rnd(1.5,3),E.rnd(2,5)*E.SC,.55,1.1,.5,E.rnd(.35,.75),0,{drag:.4,seed:Math.random()});}}}
  else{st.treeA=Math.max(0,1-st.timer/0.9);st.can=st.treeA;if(st.timer>2.2){st.phase=0;st.timer=0;st.g=0;st.treeA=1;}}
  leaf.update(dt,t,leafFn);fire.update(dt,t,null);
 },
 drawField(t){if(!prog||!prog.p)return;const g=E.gl;g.useProgram(prog.p);
  g.uniform2f(prog.uRes,E.W,E.H);g.uniform2f(prog.uC,st.cx||E.W*0.5,(st.gy||E.H*0.2));
  g.uniform1f(prog.uTime,t);g.uniform1f(prog.uCan,st.can);g.uniform1f(prog.uRoot,st.root);g.uniform1f(prog.uTreeA,st.treeA);E.drawTri();},
 drawParticles(t){const g=E.gl;
  if(nb>0&&st.g>0.01&&st.treeA>0.01&&tprog&&tprog.p){let vi=0;const ranges=[];
   for(let bi=0;bi<nb;bi++){const rev=E.clamp((st.g*1.15-bt0[bi])/0.25,0,1);if(rev<=0)continue;const start=vi/FPV;
    for(let i=0;i<SEGB;i++){const u=i/(SEGB-1);
     const px=st.cx+(bx[bi*SEGB+i]-st.cx)*st.g;const py=st.gy+(by[bi*SEGB+i]-st.gy)*st.g;
     const a2=Math.max(0,i-1),b2=Math.min(SEGB-1,i+1);
     let tx=bx[bi*SEGB+b2]-bx[bi*SEGB+a2],ty=by[bi*SEGB+b2]-by[bi*SEGB+a2];const tl=Math.hypot(tx,ty)||1;
     const nx=-ty/tl,ny=tx/tl;let w=bw[bi]*(1-u*0.6)*E.clamp(rev*1.2-u,0,1);
     verts[vi++]=px+nx*w;verts[vi++]=py+ny*w;verts[vi++]=u*2+bph[bi];verts[vi++]=0;verts[vi++]=rev*st.treeA;
     verts[vi++]=px-nx*w;verts[vi++]=py-ny*w;verts[vi++]=u*2+bph[bi];verts[vi++]=1;verts[vi++]=rev*st.treeA;}
    ranges.push({start,count:SEGB*2});}
   if(ranges.length){g.useProgram(tprog.p);g.uniform2f(tprog.uRes,E.W,E.H);g.uniform1f(tprog.uTime,t);
    g.blendFunc(g.SRC_ALPHA,g.ONE);g.bindVertexArray(vao);g.bindBuffer(g.ARRAY_BUFFER,vbo);
    g.bufferSubData(g.ARRAY_BUFFER,0,verts.subarray(0,vi));
    for(const r of ranges)g.drawArrays(g.TRIANGLE_STRIP,r.start,r.count);g.bindVertexArray(null);}}
  E.drawPool(leaf,E.ADD());E.drawPool(fire,E.ADD());},
 countParticles(){let rib=0;for(let bi=0;bi<nb;bi++)if(st.g*1.15>bt0[bi])rib+=SEGB;return leaf.n+fire.n+rib;}
});
})();
(function(){
"use strict";
const A=window.__ARC,E=A.env;
const FS=[
'#version 300 es',
'precision highp float;',
'uniform vec2 uRes,uC;uniform float uTime,uRotT,uForm,uScale,uFracA,uBurst;',
'out vec4 o;',
E.NOISE,
'float mb(vec3 p,float pw,out float trap){',
' vec3 z=p;float dr=1.,r=0.;trap=10.;',
' for(int i=0;i<7;i++){',
'  r=length(z);',
'  trap=min(trap,r);',
'  if(r>2.)break;',
'  float th=acos(clamp(z.z/max(r,1e-6),-1.,1.))*pw;',
'  float ph=atan(z.y,z.x)*pw;',
'  dr=pow(max(r,1e-6),pw-1.)*pw*dr+1.;',
'  float zr=pow(max(r,1e-6),pw);',
'  z=zr*vec3(sin(th)*cos(ph),sin(th)*sin(ph),cos(th))+p;',
' }',
' return .5*log(max(r,1e-6))*r/max(dr,1e-6);',
'}',
'void main(){',
' float mn=min(uRes.x,uRes.y);',
' vec2 uv=(gl_FragCoord.xy-uC)/mn;',
' float d0=length(uv);',
' vec3 col=mix(vec3(.025,.014,.03),vec3(.006,.004,.012),clamp(uv.y+.5,0.,1.));',
' float nb=fbm2(uv*2.+vec2(uTime*.012,0.));',
' col+=vec3(.08,.05,.03)*nb*nb;',
' col+=vec3(.5,.4,.2)*exp(-d0*3.)*.25*uFracA;',
' if(uForm>0.01&&uFracA>0.01){',
'  vec3 ro=vec3(0.,0.,-2.4);',
'  vec3 rd=normalize(vec3(uv,1.7));',
'  float cy=cos(uRotT*.3),sy=sin(uRotT*.3);',
'  float cx2=cos(.5),sx2=sin(.5);',
'  float pw=mix(2.2,8.,uForm);',
'  float S=max(uScale,.05);',
'  float bR=1.35*S;',
'  float b=dot(ro,rd),c2=dot(ro,ro)-bR*bR;',
'  float h=b*b-c2;',
'  if(h>0.){',
'   h=sqrt(h);',
'   float t=max(-b-h,0.),t1=-b+h;',
'   float glow=0.,trap=10.;',
'   float hitT=-1.;float hTrap=0.;float ao=0.;',
'   for(int i=0;i<46;i++){',
'    if(t>t1)break;',
'    vec3 p=ro+rd*t;',
'    vec3 q=vec3(p.x*cy-p.z*sy,p.y,p.x*sy+p.z*cy);',
'    q=vec3(q.x,q.y*cx2-q.z*sx2,q.y*sx2+q.z*cx2);',
'    q/=S;q*=1.15;',
'    float dd=mb(q,pw,trap)*S/1.15;',
'    glow+=exp(-abs(dd)*22.)*.05;',
'    if(dd<.0016*(1.+t)){hitT=t;hTrap=trap;ao=1.-float(i)/46.;break;}',
'    t+=max(dd*.85,.004);',
'   }',
'   if(hitT>0.){',
'    vec3 pal=vec3(.62,.46,.2)+vec3(.55,.42,.28)*cos(6.2832*(hTrap*1.3+vec3(0.,.1,.24)));',
'    float core=1.-smoothstep(.05,.45,hTrap);',
'    vec3 fc=pal*(.35+.95*ao)*2.1+vec3(1.4,1.3,1.05)*core*1.6;',
'    col=col*.15+fc*uFracA;',
'   }',
'   col+=vec3(1.25,.95,.45)*glow*uFracA*(.5+.7*uForm);',
'  }',
' }',
' if(uBurst>0.001){',
'  float rw=uBurst*1.25;',
'  col+=vec3(1.45,1.1,.5)*exp(-pow((d0-rw)*9.,2.))*(1.-uBurst)*2.2;',
'  col+=vec3(1.5,1.3,.9)*exp(-d0*3.5)*(1.-uBurst)*(1.-uBurst)*2.4;',
' }',
' o=vec4(col,1.);',
'}'
].join('\n');
const dust=new E.Pool(1024);
let prog=null;
const st={phase:0,timer:0,cx:0,cy:0,rotT:0,form:0,scale:0.4,fracA:1,burst:0};
function dustFn(p,i,dt,t){
 p.a[i]=Math.min(0.95,Math.max(0.05,p.a[i]+Math.sin(t*7+p.seed[i]*40)*1.6*dt));
 p.vx[i]+=Math.sin(t*1.6+p.seed[i]*11)*60*dt*E.SC;
}
A.reg({
 id:'FX-125',name:'황금비 프랙탈 폭발',en:'Golden Ratio Fractal Burst',
 desc:'만델벌브 거리장이 power 2.2→8 모핑으로 2초간 최면적 전개(오빗트랩 황금 팔레트·성광 글로우) — 히트스톱 정지 후 1프레임 무한 스케일 작렬, 금빛 성진 650립으로 용해.',
 tech:['Mandelbulb Sphere-trace 46','Orbit-trap Gold Palette','Power-morph Unfold','1-Frame Infinite Scale','Stardust Dissolve'],
 bloom:1.1,
 init(){
  prog=E.U(E.mkProg(E.FS_VERT,FS,'FX125'),['uRes','uC','uTime','uRotT','uForm','uScale','uFracA','uBurst']);
 },
 reset(){
  dust.clear();
  st.phase=0;st.timer=0;st.rotT=0;st.form=0;st.scale=0.4;st.fracA=1;st.burst=0;
  st.cx=E.W*0.5;st.cy=E.H*0.52;
 },
 autoPoint(){return [E.W*0.5,E.H*0.52];},
 trigger(x,y){
  if(st.phase!==0)return;
  st.phase=1;st.timer=0;st.form=0;st.scale=0.4;st.fracA=1;
  st.cx=x;st.cy=E.clamp(y,E.H*0.35,E.H*0.7);
  E.flashAdd(0.3,1,.9,.6);
 },
 update(dt,t){
  st.timer+=dt;
  if(st.phase!==2)st.rotT+=dt;
  if(st.phase===0){
   st.form=Math.max(0,st.form-dt*2);
   st.fracA=1;
  }else if(st.phase===1){
   const u=Math.min(1,st.timer/2.0);
   st.form=u*u;
   st.scale=E.lerp(0.4,1,u);
   if(u>=1){st.phase=2;st.timer=0;}
  }else if(st.phase===2){
   if(st.timer>0.05){
    st.phase=3;st.timer=0;
    st.scale=2.6;st.burst=0.001;
    E.flashAdd(1.4,1,.85,.45);E.shakeAdd(24*E.SC);E.setCA(0.013);
    for(let i=0;i<650;i++){
     const a=Math.random()*E.TAU;
     const sp=E.rnd(120,900)*E.SC;
     const m=Math.random();
     dust.spawn(st.cx,st.cy,Math.cos(a)*sp,Math.sin(a)*sp,
      E.rnd(1.8,3.6),E.rnd(2,7)*E.SC,
      1.25,.95+m*.25,.4+m*.3,E.rnd(.5,.9),0,
      {drag:1.3,grav:-120*E.SC,seed:Math.random()});
    }
   }
  }else{
   st.fracA=Math.max(0,1-st.timer/0.3);
   st.burst=st.burst>0?Math.min(1,st.burst+dt*1.8):0;
   if(st.burst>=1)st.burst=0;
   if(st.timer>3.2){st.phase=0;st.timer=0;st.form=0;st.scale=0.4;st.fracA=1;}
  }
  dust.update(dt,t,dustFn);
 },
 drawField(t){
  if(!prog||!prog.p)return;
  const g=E.gl;
  g.useProgram(prog.p);
  g.uniform2f(prog.uRes,E.W,E.H);
  g.uniform2f(prog.uC,st.cx||E.W*0.5,st.cy||E.H*0.52);
  g.uniform1f(prog.uTime,t);
  g.uniform1f(prog.uRotT,st.rotT);
  g.uniform1f(prog.uForm,st.form);
  g.uniform1f(prog.uScale,st.scale);
  g.uniform1f(prog.uFracA,st.fracA);
  g.uniform1f(prog.uBurst,st.burst);
  E.drawTri();
 },
 drawParticles(){E.drawPool(dust,E.ADD());},
 countParticles(){return dust.n;}
});
})();
(function(){
"use strict";
const A=window.__ARC,E=A.env;
const FS=[
'#version 300 es','precision highp float;','#define TAU 6.2831853',
'uniform vec2 uRes,uC;uniform float uTime,uDome,uDomeA,uRew,uFl;',
'out vec4 o;',E.NOISE,
'void main(){',
' float mn=min(uRes.x,uRes.y);',
' vec2 hv=(gl_FragCoord.xy-uC)/mn;',
' float d=length(hv);float a=atan(hv.y,hv.x);',
' vec3 col=mix(vec3(.030,.024,.020),vec3(.01,.008,.012),clamp(hv.y+.5,0.,1.));',
' float nb=fbm2(hv*2.2+vec2(uTime*.015,0.));col+=vec3(.07,.055,.035)*nb*nb;',
' float R=uDome;',
' if(R>0.005&&uDomeA>0.001){',
'  float inside=1.-smoothstep(R*.97,R*1.005,d);',
/* refractive cool time-stilled interior */
'  vec3 inv=mix(col,vec3(dot(col,vec3(.333)))*vec3(.55,.72,.98)+vec3(0.,.02,.05),.85);',
'  col=mix(col,inv,inside*uDomeA);',
/* inward-spiraling temporal current — direction REVERSES during rewind (uRew) */
'  float ld=log(max(d,1e-3));',
'  float dir=mix(1.0,-1.0,clamp(uRew,0.,1.));',
'  float warp=fbm2(hv*3.0+vec2(uTime*.2*dir,-uTime*.13*dir));',
'  float flow=sin(a*4.0+ld*9.0-uTime*2.2*dir+warp*1.6);',
'  float current=smoothstep(.45,.96,flow)*inside*(1.-smoothstep(.0,R,d));',
'  col+=vec3(.30,.72,.95)*current*uDomeA*0.9;',
/* counter-rotating finer band for depth */
'  float band2=sin(a*-6.0+ld*6.0+uTime*1.6*dir-warp*2.0);',
'  col+=vec3(.42,.30,.85)*smoothstep(.6,.98,band2)*inside*(1.-smoothstep(.0,R*.9,d))*uDomeA*0.5;',
/* luminous boundary shell + soft refraction lip */
'  col+=vec3(.55,.85,1.05)*exp(-pow((d-R)*16.,2.))*uDomeA*1.3;',
'  col+=vec3(.20,.45,.7)*exp(-pow((d-R*.96)*26.,2.))*uDomeA*0.6;',
/* convergent pull-to-center glow intensifies on rewind */
'  col+=vec3(.5,.85,1.2)*exp(-d*7./max(R,.1))*(0.3+uRew)*uDomeA*0.9;',
'  col+=vec3(.7,.9,1.1)*(1.-smoothstep(R*.03,R*.06,d))*uDomeA;',
' }',
' col+=vec3(1.05,1.02,.98)*uFl*exp(-d*2.2);',
' o=vec4(col,1.);',
'}'
].join('\n');
const N=150,HIST=80;
const ring=new Float32Array(N*HIST*2);
const deb=new E.Pool(256),glit=new E.Pool(512);
let prog=null;
const st={phase:0,timer:0,cx:0,cy:0,dome:0,domeA:0,rew:0,fl:0,head:0,frames:0,play:0,floorY:0};
function bounceFn(p,i,dt){if(p.py[i]<st.floorY&&p.vy[i]<0){p.py[i]=st.floorY;p.vy[i]*=-0.45;p.vx[i]*=0.8;p.rv[i]*=0.6;}}
function rewindFn(p,i){if(i>=N)return;const f0=Math.floor(st.play),fr2=st.play-f0;const f1=Math.min(st.frames-1,f0+1);
 const o0=(f0*N+i)*2,o1=(f1*N+i)*2;
 p.px[i]=ring[o0]+(ring[o1]-ring[o0])*fr2;p.py[i]=ring[o0+1]+(ring[o1+1]-ring[o0+1])*fr2;
 p.vx[i]=0;p.vy[i]=0;p.grav[i]=0;p.life[i]=Math.max(p.life[i],5);}
A.reg({
 id:'FX-126',name:'시간 역행의 와류',en:'Chronosphere Reversal',
 desc:'폭발 잔해가 1.1초 비산·바운스(전 궤적을 80프레임 링버퍼에 기록) → 시계 도상 대신 시간 와류 거품으로 은유: 차가운 굴절 내부 + 안쪽으로 감겨드는 시간 해류(역행 시 흐름·나선 방향이 반전) + 역회전 보조 밴드 + 발광 경계막. 잔해가 정확히 왔던 길을 LERP 역재생으로 되감겨 원점 재조립, 정상화 섬광.',
 tech:['CPU Ring-buffer Rewind','Reversing Spiral Current','Refractive Cool Interior','Counter-Rotating Band','Luminous Boundary Shell'],
 bloom:0.95,
 init(){prog=E.U(E.mkProg(E.FS_VERT,FS,'FX126'),['uRes','uC','uTime','uDome','uDomeA','uRew','uFl']);},
 reset(){deb.clear();glit.clear();st.phase=0;st.timer=0;st.dome=0;st.domeA=0;st.rew=0;st.fl=0;st.head=0;st.frames=0;st.play=0;st.cx=E.W*0.5;st.cy=E.H*0.5;},
 autoPoint(){return [E.W*0.5,E.H*0.52];},
 resize(){},
 trigger(x,y){if(st.phase!==0)return;st.phase=1;st.timer=0;st.head=0;st.frames=0;st.cx=x;st.cy=E.clamp(y,E.H*0.35,E.H*0.7);
  st.floorY=Math.max(E.H*0.06,st.cy-0.30*Math.min(E.W,E.H));deb.clear();
  E.flashAdd(0.6,1,.6,.3);E.shakeAdd(15*E.SC);
  for(let i=0;i<N;i++){const a=Math.random()*E.TAU,sp=E.rnd(220,1050)*E.SC,m=Math.random();
   deb.spawn(st.cx,st.cy,Math.cos(a)*sp,Math.sin(a)*sp,99,E.rnd(6,17)*E.SC,.85+m*.3,.5+m*.25,.25+m*.15,E.rnd(.65,.95),2,{rot:Math.random()*E.TAU,rv:E.rnd(-5,5),drag:.6,grav:-1900*E.SC});}},
 update(dt,t){
  st.timer+=dt;st.fl=Math.max(0,st.fl-dt*3);
  if(st.phase===0){st.dome=Math.max(0,st.dome-dt*1.6);st.domeA=Math.max(0,st.domeA-dt*1.6);}
  else if(st.phase===1){deb.update(dt,t,bounceFn);
   if(st.frames<HIST){const f=st.frames;for(let i=0;i<Math.min(N,deb.n);i++){ring[(f*N+i)*2]=deb.px[i];ring[(f*N+i)*2+1]=deb.py[i];}st.frames++;}
   if(st.timer>1.15){st.phase=2;st.timer=0;st.play=st.frames-1;E.flashAdd(0.4,.6,.8,1.2);E.shakeAdd(10*E.SC);}}
  else if(st.phase===2){
   st.dome=E.easeOutBack(Math.min(1,st.timer/0.35))*0.46;st.domeA=Math.min(1,st.timer/0.25);st.rew=Math.min(1,st.timer/0.4);
   if(st.timer>0.25){st.play=Math.max(0,st.play-dt*60*1.6);deb.update(0.0001,t,rewindFn);
    if(st.play<=0){st.phase=3;st.timer=0;st.fl=1;E.flashAdd(0.95,.8,.9,1.2);E.shakeAdd(14*E.SC);E.setCA(0.009);
     for(let i=0;i<Math.min(N,deb.n);i++)deb.life[i]=0.5;
     for(let i=0;i<200;i++){const a=Math.random()*E.TAU,sp=E.rnd(300,1100)*E.SC;
      glit.spawn(st.cx,st.cy,Math.cos(a)*sp,Math.sin(a)*sp,E.rnd(.4,.9),E.rnd(2,6)*E.SC,.7,.9,1.3,.95,0,{drag:2});}}}}
  else{const u=Math.min(1,st.timer/0.45);st.dome=0.46*(1-E.easeOutCubic(u));st.domeA=1-u;st.rew=Math.max(0,st.rew-dt*3);deb.update(dt,t,null);if(u>=1&&st.timer>1.2){st.phase=0;st.timer=0;}}
  glit.update(dt,t,null);
 },
 drawField(t){if(!prog||!prog.p)return;const g=E.gl;g.useProgram(prog.p);g.uniform2f(prog.uRes,E.W,E.H);g.uniform2f(prog.uC,st.cx||E.W*0.5,st.cy||E.H*0.5);
  g.uniform1f(prog.uTime,t);g.uniform1f(prog.uDome,st.dome);g.uniform1f(prog.uDomeA,st.domeA);g.uniform1f(prog.uRew,st.rew);g.uniform1f(prog.uFl,st.fl);E.drawTri();},
 drawParticles(){E.drawPool(deb,E.ADD());E.drawPool(glit,E.ADD());},
 countParticles(){return deb.n+glit.n;}
});
})();
(function(){
"use strict";
const A=window.__ARC,E=A.env;
/* radial infall + crushing rings + black core — deliberately NOT a spiral disk */
const FS=[
'#version 300 es','precision highp float;','#define TAU 6.2831853',
'uniform vec2 uRes,uC;uniform float uTime,uSuck,uDet,uSing;',
'out vec4 o;',E.NOISE,
'void main(){',
' float mn=min(uRes.x,uRes.y);',
' vec2 p=(gl_FragCoord.xy-uC)/mn;',
' float d=length(p);float a=atan(p.y,p.x);',
' vec3 col=mix(vec3(.014,.008,.026),vec3(.002,.001,.007),clamp(d*1.4,0.,1.));',
/* radial infall striations — straight rays streaming inward (not orbital) */
' float rays=pow(abs(sin(a*16.+sin(a*3.)*1.5)),3.0);',                 /* angular ray pattern */
' float inflow=fract(d*3.0+uTime*1.4*(0.4+uSuck));',                    /* inward-moving dashes */
' float stream=rays*(0.4+0.6*inflow)*(1.-smoothstep(.0,.95,d))*(0.5+1.4*uSuck);',
' col+=mix(vec3(.55,.06,.62),vec3(.26,.04,.55),fract(a*2.0))*stream*0.9;',
/* crushing concentric compression rings collapsing toward core */
' float cr=1.0-uSuck*0.7;',
' col+=vec3(.7,.12,.8)*exp(-pow((d-cr*.62)*7.,2.))*(.4+uSuck);',
' col+=vec3(.5,.08,.7)*exp(-pow((d-cr*.38)*9.,2.))*(.4+uSuck);',
/* singularity: pure black core that grows as it crushes */
' float core=1.-smoothstep(.0,.18*(1.-uSuck*.6)+.02,d);',
' col*=mix(1.,0.,core*uSing);',
' col+=vec3(.9,.30,1.0)*exp(-pow((d-(.18*(1.-uSuck*.6)+.02))*15.,2.))*(.5+1.6*uSuck);',
/* detonation: sharp radial shock + counter cyan ring */
' col+=vec3(1.1,.4,1.15)*exp(-pow((d-uDet*1.3)*7.,2.))*(1.-uDet)*1.8;',
' col+=vec3(.3,.9,1.05)*exp(-pow((d-uDet*1.1)*11.,2.))*(1.-uDet)*0.9;',
' col+=(h21(p*uRes+uTime)-.5)*.012;',
' o=vec4(col,1.);',
'}'
].join('\n');
const dust=new E.Pool(900),spark=new E.Pool(640);
let prog=null;
const st={phase:0,timer:0,cx:0,cy:0,suck:0,det:0,sing:0,acc:0,R:0};
function geom(){st.cx=E.W*0.5;st.cy=E.H*0.5;st.R=Math.min(E.W,E.H)*0.45;}
/* pure radial infall: pull straight in, almost no tangential (vs NX-10 swirl) */
function pull(p,i,dt){
 const dx=p.px[i]-st.cx,dy=p.py[i]-st.cy;const r=Math.hypot(dx,dy)||1;
 const ux=dx/r,uy=dy/r;
 const g=(420+1200*st.suck)*E.SC;
 const tan=40*E.SC*(1-st.suck); /* tiny residual spin, fades to 0 as it crushes */
 p.vx[i]+=(-ux*g - uy*tan)*dt;
 p.vy[i]+=(-uy*g + ux*tan)*dt;
 p.vx[i]*=Math.exp(-0.7*dt);p.vy[i]*=Math.exp(-0.7*dt);
 if(r<12*E.SC&&st.phase===1)p.life[i]=0;
}
function spawnRing(pool,n,al,shape,sz,cr,cg,cb){
 for(let i=0;i<n;i++){const a=Math.random()*E.TAU,rr=st.R*E.rnd(.7,1.12);
  pool.spawn(st.cx+Math.cos(a)*rr,st.cy+Math.sin(a)*rr,0,0,E.rnd(2.5,5),E.rnd(sz[0],sz[1])*E.SC,cr,cg,cb,E.rnd(al[0],al[1]),shape,{seed:Math.random()});}
}
function detonate(){
 st.phase=3;st.timer=0;st.det=0.001;st.sing=0;
 E.flashAdd(.7,.85,.45,1.0);E.shakeAdd(28*E.SC);E.setCA(.022);
 for(let i=0;i<240;i++){const a=Math.random()*E.TAU,s=E.rnd(800,2300)*E.SC,m=Math.random();
  spark.spawn(st.cx,st.cy,Math.cos(a)*s,Math.sin(a)*s,E.rnd(.4,1.0),E.rnd(3,9)*E.SC,.85+m*.2,.25+m*.3,.95,E.rnd(.6,.95),0,{drag:3.8,seed:Math.random()});}
 for(let i=0;i<150;i++){const a=Math.random()*E.TAU,s=E.rnd(300,950)*E.SC;
  dust.spawn(st.cx,st.cy,Math.cos(a)*s,Math.sin(a)*s,E.rnd(.6,1.3),E.rnd(5,12)*E.SC,.5,.10,.6,E.rnd(.25,.5),3,{drag:2.2,seed:Math.random()});}
}
A.reg({
 id:'FX-138',name:'공허 물질 붕괴',en:'Void Matter Implosion',
 desc:'NX-10(나선 와류)과 차별 — 궤도 회전이 아닌 직선 방사 낙하. 물질이 16방향 방사 줄무늬를 따라 곧장 코어로 빨려들고 압축 동심 링이 안쪽으로 무너진다. 절대흑 특이점이 성장 → 1프레임 히트스톱 → 폭발적 방사 충격 + 카운터 시안 링.',
 tech:['Radial Infall (no spiral)','Crushing Compression Rings','Growing Black Singularity','Hit-Stop Detonation','Counter-Cyan Shock'],
 bloom:0.86,
 init(){prog=E.U(E.mkProg(E.FS_VERT,FS,'FX138'),['uRes','uC','uTime','uSuck','uDet','uSing']);geom();},
 reset(){dust.clear();spark.clear();st.phase=0;st.timer=0;st.suck=0;st.det=0;st.sing=0;st.acc=0;geom();},
 resize(){geom();},
 autoPoint(){return [E.W*0.5,E.H*0.5];},
 trigger(x,y){if(st.phase!==0&&st.phase!==3)return;st.cx=x;st.cy=E.clamp(y,E.H*0.32,E.H*0.68);
  st.phase=1;st.timer=0;st.det=0;st.sing=0;E.setCA(.004);
  spawnRing(dust,360,[.14,.34],3,[3,7],.45,.06,.55);
  spawnRing(spark,120,[.4,.7],0,[2,5],.75,.15,.9);},
 update(dt,t){
  st.timer+=dt;
  if(st.phase===1){
   {const u=Math.min(1,st.timer/1.2);st.suck=u*u;}
   st.sing=Math.min(1,st.timer/0.9);
   st.acc+=dt*55;while(st.acc>1&&dust.n<840){st.acc--;const a=Math.random()*E.TAU,rr=st.R*E.rnd(.85,1.12);
    dust.spawn(st.cx+Math.cos(a)*rr,st.cy+Math.sin(a)*rr,0,0,E.rnd(2.5,5),E.rnd(3,7)*E.SC,.45,.06,.55,E.rnd(.14,.34),3,{seed:Math.random()});}
   if(st.timer>1.25){st.phase=2;st.timer=0;st.suck=1;}
  }else if(st.phase===2){if(st.timer>0.05)detonate();}
  else if(st.phase===3){st.suck=Math.max(0,st.suck-dt*2.4);st.sing=0;st.det=Math.min(1,st.det+dt*1.3);
   if(st.timer>1.5){st.phase=0;st.timer=0;st.det=0;}}
  else{st.suck=Math.max(0,st.suck-dt*1.5);}
  dust.update(dt,t,pull);spark.update(dt,t,st.phase===1?pull:null);
 },
 drawField(t){if(!prog||!prog.p)return;const g=E.gl;g.useProgram(prog.p);
  g.uniform2f(prog.uRes,E.W,E.H);g.uniform2f(prog.uC,st.cx||E.W*0.5,st.cy||E.H*0.5);
  g.uniform1f(prog.uTime,t);g.uniform1f(prog.uSuck,st.suck);g.uniform1f(prog.uDet,st.det);g.uniform1f(prog.uSing,st.sing);E.drawTri();},
 drawParticles(){E.drawPool(dust,E.ALPHA());E.drawPool(spark,E.ADD());},
 countParticles(){return dust.n+spark.n;}
});
})();
(function(){
"use strict";
const A=window.__ARC,E=A.env;
const FS=[
'#version 300 es','precision highp float;','#define TAU 6.2831853',
'uniform vec2 uRes,uC;uniform float uTime,uBloom,uPillar,uStrike,uDesc;',
'out vec4 o;',E.NOISE,
'void main(){',
' float mn=min(uRes.x,uRes.y);',
' vec2 p=(gl_FragCoord.xy-uC)/mn;',
' float d=length(p);float a=atan(p.y,p.x);',
' vec3 col=mix(vec3(.040,.022,.040),vec3(.006,.004,.012),clamp(d*1.3,0.,1.));',
/* layered procedural lotus petals — soft rose -> hot pink */
' float warp=fbm2(p*4.+vec2(uTime*.1,uTime*.07));',
' for(int L=0;L<3;L++){float fl=float(L);float ph=fl*0.45;float rad=(.30+fl*.13)*uBloom;',
'  float lobe=abs(cos(a*4.0+ph));',
'  float edge=rad*(.62+.42*lobe)+warp*.03;',
'  float pet=(1.-smoothstep(edge-.05,edge+.04,d))*smoothstep(edge*.32,edge*.7,d);',
'  vec3 pc=mix(vec3(1.0,.71,.76),vec3(1.0,.08,.58),fl/2.);',
'  col+=pc*pet*(.5+.5*lobe)*1.1*uBloom;',
'  col+=vec3(1.0,.55,.7)*pet*(1.-smoothstep(edge-.02,edge+.02,d))*.6*uBloom;',
' }',
/* ── refined divine pillar ── descends from top, volumetric layered, caustic flicker */
' float px=abs(p.x);',
' float topMask=smoothstep(uDesc-0.06,uDesc+0.02,p.y);',           /* beam front travels downward (uDesc: top->0) */
' float caustic=0.78+0.22*n2(vec2(px*40.,p.y*9.-uTime*7.));',       /* shimmering inner caustics */
' float taper=1.0+0.5*smoothstep(.0,.45,abs(p.y));',                /* slight flare toward top */
' float pwO=(0.10+0.05*(1.-uPillar))*taper*(1.+uStrike*1.0);',
' float pwI=pwO*0.34;',
' float halo=exp(-pow(px/(pwO*1.8),2.))*uPillar*topMask;',          /* soft outer glow */
' float body=(1.-smoothstep(pwO*.7,pwO,px))*uPillar*topMask;',
' float coreB=(1.-smoothstep(pwI*.6,pwI,px))*uPillar*topMask;',
' col+=vec3(1.0,.78,.30)*halo*0.8;',
' col+=vec3(1.0,.85,.42)*body*caustic*1.25;',
' col+=vec3(1.05,.98,.85)*coreB*caustic*1.9;',
/* radiating god-ray shafts from the impact point */
' float shafts=pow(abs(sin(a*9.+sin(a*2.)*1.5)),6.0);',
' col+=vec3(1.0,.86,.5)*shafts*exp(-d*2.6)*uStrike*0.9;',
/* impact bloom at lotus base */
' col+=vec3(1.0,.9,.6)*exp(-d*d*30.)*uStrike*2.0;',
' col+=vec3(1.0,.84,.45)*exp(-d*d*5.)*uStrike*1.2;',
' col+=(h21(p*uRes+uTime)-.5)*.011;',
' o=vec4(col,1.);',
'}'
].join('\n');
const petal=new E.Pool(560),ember=new E.Pool(560);
let prog=null;
const st={phase:0,timer:0,cx:0,cy:0,bloom:0,pillar:0,strike:0,desc:1.4,acc:0};
function geom(){st.cx=E.W*0.5;st.cy=E.H*0.56;}
function pfn(p,i,dt){p.vx[i]*=Math.exp(-1.6*dt);p.vy[i]*=Math.exp(-1.6*dt);}
function efn(p,i,dt){p.vx[i]+=Math.sin(p.seed[i]*40+p.py[i]*0.02)*30*E.SC*dt;}
function bloomBurst(){
 for(let i=0;i<160;i++){const a=Math.random()*E.TAU,sp=E.rnd(70,260)*E.SC,m=Math.random();
  petal.spawn(st.cx,st.cy,Math.cos(a)*sp,Math.sin(a)*sp-40*E.SC,E.rnd(1.4,2.6),E.rnd(10,22)*E.SC,1.0,.45+m*.35,.62+m*.25,E.rnd(.4,.7),1,{rot:a,rv:E.rnd(-1,1),seed:Math.random()});}
}
function strikeFx(){
 st.phase=3;st.timer=0;st.strike=0.001;
 E.flashAdd(.85,1.0,.9,.6);E.shakeAdd(30*E.SC);E.setCA(.012);
 for(let i=0;i<220;i++){const sp=E.rnd(900,2600)*E.SC,jx=E.rnd(-1,1)*0.16;
  ember.spawn(st.cx+E.rnd(-26,26)*E.SC,st.cy,jx*sp,sp,E.rnd(.5,1.2),E.rnd(3,8)*E.SC,1.0,.85,.4,E.rnd(.6,.95),0,{drag:2.4,grav:-260*E.SC,seed:Math.random()});}
 for(let i=0;i<90;i++){const a=Math.random()*E.TAU,sp=E.rnd(300,900)*E.SC;
  ember.spawn(st.cx,st.cy,Math.cos(a)*sp,Math.abs(Math.sin(a))*sp,E.rnd(.4,.9),E.rnd(4,10)*E.SC,1.0,.9,.55,E.rnd(.4,.7),0,{drag:3.0,grav:-180*E.SC,seed:Math.random()});}
}
A.reg({
 id:'FX-140',name:'신성 연꽃 강타',en:'Divine Lotus Bombardment',
 desc:'분홍 연꽃 다층 만개(2초 ease-out) → 상단에서 강하하는 정련된 신성 광주: 외곽 헤일로·바디·백열 코어 3중 적층 + 코스틱 명멸 + 상부 플레어. 강타 시 갓레이 샤프트가 방사되고 충돌점 블룸·화면 진동. 황금 ember 상승 아크.',
 tech:['Layered Lotus Bloom','Descending Beam Front','3-Layer Volumetric Pillar','Caustic Flicker + Top Flare','Radiating God-Ray Shafts','Impact Bloom'],
 bloom:0.92,
 init(){prog=E.U(E.mkProg(E.FS_VERT,FS,'FX140'),['uRes','uC','uTime','uBloom','uPillar','uStrike','uDesc']);geom();},
 reset(){petal.clear();ember.clear();st.phase=0;st.timer=0;st.bloom=0;st.pillar=0;st.strike=0;st.desc=1.4;st.acc=0;geom();},
 resize(){geom();},
 autoPoint(){return [E.W*0.5,E.H*0.56];},
 trigger(x,y){if(st.phase!==0&&st.phase!==3)return;st.cx=x;st.cy=E.clamp(y,E.H*0.42,E.H*0.7);
  st.phase=1;st.timer=0;st.bloom=0;st.pillar=0;st.strike=0;st.desc=1.4;E.setCA(.003);bloomBurst();},
 update(dt,t){
  st.timer+=dt;
  if(st.phase===1){st.bloom=E.easeOutCubic(Math.min(1,st.timer/2.0));
   if(st.timer>2.0){st.phase=2;st.timer=0;}}
  else if(st.phase===2){st.bloom=1;st.pillar=Math.min(1,st.pillar+dt*6.0);
   st.desc=E.lerp(1.4,-0.2,E.easeOutQuart(Math.min(1,st.timer/0.28)));   /* beam front descends */
   if(st.timer>0.30){strikeFx();}}
  else if(st.phase===3){st.bloom=Math.max(0,st.bloom-dt*0.4);st.pillar=Math.max(0,st.pillar-dt*1.0);st.desc=-0.2;
   st.strike=Math.min(1,st.strike+dt*1.2);
   if(st.timer>1.6){st.phase=0;st.timer=0;st.strike=0;st.pillar=0;st.desc=1.4;}}
  else{st.bloom=Math.max(0,st.bloom-dt*1.0);}
  petal.update(dt,t,pfn);ember.update(dt,t,efn);
 },
 drawField(t){if(!prog||!prog.p)return;const g=E.gl;g.useProgram(prog.p);
  g.uniform2f(prog.uRes,E.W,E.H);g.uniform2f(prog.uC,st.cx||E.W*0.5,st.cy||E.H*0.56);
  g.uniform1f(prog.uTime,t);g.uniform1f(prog.uBloom,st.bloom);g.uniform1f(prog.uPillar,st.pillar);g.uniform1f(prog.uStrike,st.strike);g.uniform1f(prog.uDesc,st.desc);E.drawTri();},
 drawParticles(){E.drawPool(petal,E.ALPHA());E.drawPool(ember,E.ADD());},
 countParticles(){return petal.n+ember.n;}
});
})();
(function(){
"use strict";
const A=window.__ARC,E=A.env;
const FS=[
'#version 300 es','precision highp float;','#define TAU 6.2831853',
'uniform vec2 uRes,uC;uniform float uTime,uCore,uReach,uPulse;',
'out vec4 o;',E.NOISE,
'void main(){',
' float mn=min(uRes.x,uRes.y);',
' vec2 p=(gl_FragCoord.xy-uC)/mn;',
' float d=length(p);float a=atan(p.y,p.x);',
' vec3 col=vec3(.004,.012,.006);',
/* living green energy membrane */
' float memb=fbm2(p*3.2+vec2(uTime*.15,-uTime*.1));',
' float field=0.35+0.65*memb;',
/* jagged corrosion front: angular tendrils that pierce outward */
' float warp=fbm2(p*4.0+vec2(uTime*.4,uTime*.25));',
' float tend=pow(abs(sin(a*7.0+warp*3.0+sin(a*3.0)*1.2)),3.0);',
' float edge=uCore+uReach*0.55*(0.30+0.70*tend)+warp*0.045;',
' float consumed=1.-smoothstep(edge-0.02,edge+0.02,d);',     /* inside front = devoured */
/* surviving green only outside the corrosion */
' float green=(1.-consumed)*field*(1.-smoothstep(.0,1.05,d));',
' col+=mix(vec3(.10,.42,.10),vec3(.18,.95,.10),clamp(memb*1.2,0.,1.))*green*0.9;',
/* searing torn rim where energy is ripped apart at the erosion front */
' float rim=exp(-pow((d-edge)*13.,2.));',
' col+=vec3(.4,1.05,.30)*rim*(1.0+0.8*uPulse)*1.5;',
' col+=vec3(.6,1.2,.4)*exp(-pow((d-edge)*30.,2.))*1.2;',     /* hot inner lip */
/* absolute black core that pierces through */
' float coreEdge=uCore*0.92;',
' float blackness=1.-smoothstep(coreEdge-0.01,coreEdge+0.03,d);',
' col*=mix(1.,0.,blackness);',
/* menacing inner glow ring pulsing on the void boundary */
' col+=vec3(.16,.85,.22)*exp(-pow((d-uCore)*10.,2.))*(.4+0.9*uPulse);',
/* faint sickly veins crawling inside the void toward center */
' float veins=pow(abs(sin(a*12.-uTime*1.5+warp*2.)),8.0)*consumed*(1.-blackness);',
' col+=vec3(.10,.55,.14)*veins*0.7;',
' col+=(h21(p*uRes+uTime)-.5)*.011;',
' o=vec4(col,1.);',
'}'
].join('\n');
const motes=new E.Pool(760);  /* green energy being devoured (pulled inward) */
const ash=new E.Pool(420);    /* dark flakes drifting off the corrosion */
let prog=null;
const st={phase:0,timer:0,cx:0,cy:0,core:0,reach:0,pulse:0,acc:0,R:0};
function geom(){st.cx=E.W*0.5;st.cy=E.H*0.5;st.R=Math.min(E.W,E.H)*0.5;}
function moteFn(p,i,dt){ /* drawn inexorably toward the core, consumed */
 const dx=p.px[i]-st.cx,dy=p.py[i]-st.cy;const r=Math.hypot(dx,dy)||1;const ux=dx/r,uy=dy/r;
 const g=(120+520*st.core)*E.SC;
 p.vx[i]+=(-ux*g)*dt;p.vy[i]+=(-uy*g)*dt;
 p.vx[i]*=Math.exp(-1.2*dt);p.vy[i]*=Math.exp(-1.2*dt);
 if(r<st.R*st.core*0.9+8)p.life[i]=0; /* swallowed by the void */
}
function ashFn(p,i,dt){p.vx[i]*=Math.exp(-0.8*dt);p.vy[i]*=Math.exp(-0.8*dt);}
function awaken(){
 E.shakeAdd(14*E.SC);E.setCA(.010);E.flashAdd(.3,.2,.6,.2);
 for(let i=0;i<120;i++){const a=Math.random()*E.TAU,rr=st.R*E.rnd(.3,.7);
  ash.spawn(st.cx+Math.cos(a)*rr,st.cy+Math.sin(a)*rr,Math.cos(a)*E.rnd(60,180)*E.SC,Math.sin(a)*E.rnd(60,180)*E.SC,E.rnd(.6,1.4),E.rnd(4,10)*E.SC,.05,.12,.05,E.rnd(.3,.6),3,{rot:a,rv:E.rnd(-3,3),seed:Math.random()});}
}
A.reg({
 id:'FX-141',name:'잠식하는 공허핵',en:'Devouring Void Core',
 desc:'중앙의 절대흑 원이 맥동하며 살아있는 녹색 에너지 막을 바깥으로 잠식·관통한다. 들쭉날쭉한 부식 촉수가 방사로 뻗어 막을 찢고(작열 녹색 단면), 흑핵 내부엔 병적인 정맥이 중심으로 기어든다. 에너지 입자는 코어로 빨려 삼켜지고 흑색 박편이 떨어져 나온다. 위협적·유기적.',
 tech:['Pulsing Black Void Core','Jagged Corrosion Tendrils','Searing Torn Rim','Inward Devour Particles','Sickly Inner Veins'],
 bloom:0.8,
 init(){prog=E.U(E.mkProg(E.FS_VERT,FS,'FX141'),['uRes','uC','uTime','uCore','uReach','uPulse']);geom();},
 reset(){motes.clear();ash.clear();st.phase=0;st.timer=0;st.core=0;st.reach=0;st.pulse=0;st.acc=0;geom();},
 resize(){geom();},
 autoPoint(){return [E.W*0.5,E.H*0.5];},
 trigger(x,y){if(st.phase!==0&&st.phase!==3)return;st.cx=x;st.cy=E.clamp(y,E.H*0.34,E.H*0.66);
  st.phase=1;st.timer=0;st.core=0.04;st.reach=0;awaken();},
 update(dt,t){
  st.timer+=dt;st.pulse=0.5+0.5*Math.sin(t*3.2);
  if(st.phase===1){ /* core grows, corrosion reaches out */
   st.core=E.lerp(0.04,0.16,E.easeOutCubic(Math.min(1,st.timer/1.0)));
   st.reach=E.easeOutQuart(Math.min(1,st.timer/1.2));
   st.acc+=dt*120;while(st.acc>1&&motes.n<700){st.acc--;const a=Math.random()*E.TAU,rr=st.R*E.rnd(.55,1.0);
    motes.spawn(st.cx+Math.cos(a)*rr,st.cy+Math.sin(a)*rr,0,0,E.rnd(1.5,3.5),E.rnd(2,5)*E.SC,.2,.85,.2,E.rnd(.3,.6),0,{seed:Math.random()});}
   if(st.timer>1.3){st.phase=2;st.timer=0;}}
  else if(st.phase===2){ /* sustained menace, slow throb of reach */
   st.core=0.16+0.015*Math.sin(t*2.0);st.reach=0.9+0.1*Math.sin(t*1.3);
   st.acc+=dt*90;while(st.acc>1&&motes.n<700){st.acc--;const a=Math.random()*E.TAU,rr=st.R*E.rnd(.55,1.0);
    motes.spawn(st.cx+Math.cos(a)*rr,st.cy+Math.sin(a)*rr,0,0,E.rnd(1.5,3.5),E.rnd(2,5)*E.SC,.2,.85,.2,E.rnd(.3,.6),0,{seed:Math.random()});}
   if(st.timer>5.0){st.phase=3;st.timer=0;E.shakeAdd(10*E.SC);}}
  else if(st.phase===3){ /* recede */
   st.core=Math.max(0,st.core-dt*0.25);st.reach=Math.max(0,st.reach-dt*0.8);
   if(st.timer>1.6){st.phase=0;st.timer=0;st.core=0;st.reach=0;}}
  else{st.core=Math.max(0,st.core-dt*0.4);st.reach=Math.max(0,st.reach-dt);}
  motes.update(dt,t,moteFn);ash.update(dt,t,ashFn);
 },
 drawField(t){if(!prog||!prog.p)return;const g=E.gl;g.useProgram(prog.p);
  g.uniform2f(prog.uRes,E.W,E.H);g.uniform2f(prog.uC,st.cx||E.W*0.5,st.cy||E.H*0.5);
  g.uniform1f(prog.uTime,t);g.uniform1f(prog.uCore,st.core);g.uniform1f(prog.uReach,st.reach);g.uniform1f(prog.uPulse,st.pulse);E.drawTri();},
 drawParticles(){E.drawPool(ash,E.ALPHA());E.drawPool(motes,E.ADD());},
 countParticles(){return motes.n+ash.n;}
});
})();
(function(){
"use strict";
const A=window.__ARC,E=A.env;
const FS=[
'#version 300 es','precision highp float;','#define TAU 6.2831853',
'uniform vec2 uRes,uC;uniform float uTime,uSpin,uPow,uHalt;',
'out vec4 o;',E.NOISE,
'void main(){',
' float mn=min(uRes.x,uRes.y);',
' vec2 p=(gl_FragCoord.xy-uC)/mn;',
' float d=length(p);float a=atan(p.y,p.x);',
/* deep ash-purple smoke base with volume */
' float bg=fbm2(p*2.4+vec2(-uSpin*.15,uTime*.1));',
' vec3 col=mix(vec3(.060,.020,.066),vec3(.004,.002,.012),clamp(d*1.25,0.,1.));',
' col+=vec3(.10,.04,.12)*bg*bg*(1.-smoothstep(.2,1.1,d));',
' float ar=a+uSpin;',
' float swirl=fbm2(vec2(ar*1.6,d*4.-uSpin*1.1));',
' float fine=fbm2(vec2(ar*4.2-uSpin*2.,d*8.+uSpin*.5));',
/* primary sweeping crescents (3) */
' float arcs=0.;',
' for(int k=0;k<3;k++){float ko=float(k)*2.094;',
'  float band=sin(ar*1.0+ko+swirl*1.8);',
'  float cr=smoothstep(.50,1.,band);',
'  float rad=exp(-pow((d-(.16+.15*float(k)))*6.2,2.));',
'  arcs+=cr*rad;',
' }',
/* secondary counter-rotating finer filaments for depth */
' float ar2=a-uSpin*1.4;',
' float arc2=0.;',
' for(int k=0;k<2;k++){float ko=float(k)*3.1416;',
'  float band=sin(ar2*2.0+ko+fine*2.4);',
'  arc2+=smoothstep(.62,1.,band)*exp(-pow((d-(.22+.12*float(k)))*8.,2.));',
' }',
' float flick=.7+.5*n2(vec2(ar*9.,uTime*10.));',
' float emspeck=smoothstep(.86,1.,n2(vec2(ar*40.,d*30.-uTime*6.)));', /* ember speckle inside flame */
' float fireA=(arcs*flick+arc2*0.6)*uPow;',
/* triadic grade: ash-purple base -> orange -> yellow -> white tip */
' vec3 fire=mix(vec3(1.0,.62,.10),vec3(1.0,1.0,.30),smoothstep(.30,1.,fireA));',
' fire=mix(vec3(.20,.10,.22),fire,smoothstep(.04,.42,fireA));',
' col+=fire*fireA*1.4;',
' col+=vec3(1.0,.85,.4)*emspeck*fireA*0.8;',
' col+=vec3(.35,.55,1.0)*arc2*uPow*0.10;',                            /* cool rim on counter filaments */
/* central inferno core with caustic shimmer */
' float caust=0.7+0.3*n2(vec2(d*30.,a*6.+uTime*5.));',
' col+=vec3(1.0,.78,.34)*exp(-d*d*14.)*uPow*caust*1.3;',
' col+=vec3(1.0,1.0,.75)*exp(-d*d*55.)*uPow*1.7;',
/* halt shock ring */
' col+=vec3(1.0,.7,.2)*exp(-pow((d-.36)*8.,2.))*uHalt*1.6;',
' col*=1.-0.22*d;',
' col+=(h21(p*uRes+uTime)-.5)*.012;',
' o=vec4(col,1.);',
'}'
].join('\n');
const fire=new E.Pool(900),spark=new E.Pool(420),smoke=new E.Pool(420);
let prog=null;
const st={phase:0,timer:0,cx:0,cy:0,spin:0,spinV:0,pow:0,halt:0,acc:0,sacc:0,R:0};
function geom(){st.cx=E.W*0.5;st.cy=E.H*0.5;st.R=Math.min(E.W,E.H)*0.34;}
function orbit(p,i,dt){
 const dx=p.px[i]-st.cx,dy=p.py[i]-st.cy;const r=Math.hypot(dx,dy)||1;const ux=dx/r,uy=dy/r;
 const sw=st.spinV*Math.min(1,st.R/Math.max(r,30))*E.SC;const pin=60*E.SC;
 p.vx[i]+=(-uy*sw-ux*pin)*dt;p.vy[i]+=(ux*sw-uy*pin)*dt;
 p.vx[i]*=Math.exp(-1.0*dt);p.vy[i]*=Math.exp(-1.0*dt);
}
function sparkFn(p,i,dt){ /* spiral inward sparks */
 const dx=p.px[i]-st.cx,dy=p.py[i]-st.cy;const r=Math.hypot(dx,dy)||1;const ux=dx/r,uy=dy/r;
 const sw=st.spinV*1.3*E.SC;
 p.vx[i]+=(-uy*sw-ux*140*E.SC)*dt;p.vy[i]+=(ux*sw-uy*140*E.SC)*dt;
 p.vx[i]*=Math.exp(-0.6*dt);p.vy[i]*=Math.exp(-0.6*dt);
}
function spawnRing(pool,n,al,shape,sz,cr,cg,cb,fn){
 for(let i=0;i<n;i++){const a=Math.random()*E.TAU,rr=st.R*E.rnd(.5,1.05),m=Math.random();const tsp=E.rnd(120,300)*E.SC;
  pool.spawn(st.cx+Math.cos(a)*rr,st.cy+Math.sin(a)*rr,-Math.sin(a)*tsp,Math.cos(a)*tsp,E.rnd(.5,1.2),E.rnd(sz[0],sz[1])*E.SC,cr,cg*(.7+.3*m),cb,E.rnd(al[0],al[1]),shape,{rot:a,rv:E.rnd(-2,2),seed:Math.random()});}
}
A.reg({
 id:'FX-142',name:'점화 초승달 와류',en:'Ignited Crescent Vortex',
 desc:'세 갈래 화염 초승달 + 역회전 미세 필라멘트 2중 레이어로 깊이를 더한 불꽃 와류. 구심 가속(느림→빠름)→급정지, 중심 인페르노 코스틱 코어, 내부 ember 스펙클, 나선 흡입 스파크, 애시퍼플 연기 볼륨. 삼색(황·주황·애시퍼플) 그라데이션 + 쿨 림.',
 tech:['Dual-Layer Counter-Rotation','Ember Speckle Inside Flame','Caustic Inferno Core','Spiral Intake Sparks','Ash-Purple Smoke Volume','Triadic Grade + Cool Rim'],
 bloom:0.86,
 init(){prog=E.U(E.mkProg(E.FS_VERT,FS,'FX142'),['uRes','uC','uTime','uSpin','uPow','uHalt']);geom();},
 reset(){fire.clear();spark.clear();smoke.clear();st.phase=0;st.timer=0;st.spin=0;st.spinV=0;st.pow=0;st.halt=0;st.acc=0;st.sacc=0;geom();},
 resize(){geom();},
 autoPoint(){return [E.W*0.5,E.H*0.5];},
 trigger(x,y){if(st.phase!==0&&st.phase!==2)return;st.cx=x;st.cy=E.clamp(y,E.H*0.3,E.H*0.7);
  st.phase=1;st.timer=0;st.spinV=2.0;st.pow=0;st.halt=0;E.setCA(.004);
  spawnRing(smoke,140,[.12,.26],3,[14,30],.18,.10,.22);
  spawnRing(fire,240,[.4,.7],1,[6,16],1.0,.55,.12);},
 update(dt,t){
  st.timer+=dt;
  if(st.phase===1){
   st.spinV=E.lerp(st.spinV,16.0,1-Math.exp(-dt*1.4));st.pow=Math.min(1,st.pow+dt*2.0);
   st.acc+=dt*130;while(st.acc>1&&fire.n<840){st.acc--;const a=Math.random()*E.TAU,rr=st.R*E.rnd(.55,1.05),tsp=E.rnd(120,300)*E.SC,m=Math.random();
    fire.spawn(st.cx+Math.cos(a)*rr,st.cy+Math.sin(a)*rr,-Math.sin(a)*tsp,Math.cos(a)*tsp,E.rnd(.5,1.2),E.rnd(6,16)*E.SC,1.0,.5+m*.4,.12,E.rnd(.4,.7),1,{rot:a,rv:E.rnd(-2,2),seed:Math.random()});
    if(fire.n%5===0&&smoke.n<400)smoke.spawn(st.cx+Math.cos(a)*rr,st.cy+Math.sin(a)*rr,-Math.sin(a)*tsp*.5,Math.cos(a)*tsp*.5,E.rnd(.8,1.6),E.rnd(14,30)*E.SC,.18,.10,.22,E.rnd(.12,.24),3,{seed:Math.random()});}
   st.sacc+=dt*70;while(st.sacc>1&&spark.n<360){st.sacc--;const a=Math.random()*E.TAU,rr=st.R*E.rnd(.6,1.05);
    spark.spawn(st.cx+Math.cos(a)*rr,st.cy+Math.sin(a)*rr,0,0,E.rnd(.5,1.1),E.rnd(2,5)*E.SC,1.0,.9,.5,E.rnd(.5,.85),0,{seed:Math.random()});}
   if(st.timer>2.4){st.phase=2;st.timer=0;st.halt=0.001;E.shakeAdd(20*E.SC);E.setCA(.014);E.flashAdd(.5,1.0,.7,.25);}}
  else if(st.phase===2){
   st.spinV=E.lerp(st.spinV,0.0,1-Math.exp(-dt*6.0));st.pow=Math.max(0,st.pow-dt*0.7);st.halt=Math.min(1,st.halt+dt*1.4);
   if(st.timer>1.6){st.phase=0;st.timer=0;st.halt=0;}}
  else{st.spinV=E.lerp(st.spinV,0,1-Math.exp(-dt*3.));st.pow=Math.max(0,st.pow-dt*1.2);}
  st.spin+=st.spinV*dt;
  fire.update(dt,t,orbit);smoke.update(dt,t,orbit);spark.update(dt,t,sparkFn);
 },
 drawField(t){if(!prog||!prog.p)return;const g=E.gl;g.useProgram(prog.p);
  g.uniform2f(prog.uRes,E.W,E.H);g.uniform2f(prog.uC,st.cx||E.W*0.5,st.cy||E.H*0.5);
  g.uniform1f(prog.uTime,t);g.uniform1f(prog.uSpin,st.spin);g.uniform1f(prog.uPow,st.pow);g.uniform1f(prog.uHalt,st.halt);E.drawTri();},
 drawParticles(){E.drawPool(smoke,E.ALPHA());E.drawPool(fire,E.ADD());E.drawPool(spark,E.ADD());},
 countParticles(){return fire.n+spark.n+smoke.n;}
});
})();
(function(){
"use strict";
const A=window.__ARC,E=A.env;
const FS=[
'#version 300 es','precision highp float;','#define TAU 6.2831853',
'uniform vec2 uRes,uC;uniform float uTime,uCharge,uShat;',
'out vec4 o;',E.NOISE,
'void main(){',
' float mn=min(uRes.x,uRes.y);',
' vec2 p=(gl_FragCoord.xy-uC)/mn;',
' float d=length(p);',
' vec3 col=mix(vec3(.018,.020,.028),vec3(.003,.003,.008),clamp(d*1.3,0.,1.));',
' float pulse=.85+.15*sin(uTime*4.);',
' float orb=exp(-d*d*(70.-40.*uCharge))*uCharge*pulse;',
' col+=vec3(1.05,1.02,1.0)*orb*2.2;',
' float halo=exp(-d*d*9.)*uCharge*.6;',
' float hue=fbm2(p*5.+uTime*.3);',
' vec3 irid=.5+.5*cos(TAU*(hue+vec3(0.,.33,.66)));',
' col+=irid*halo;',
' col+=vec3(1.0,1.0,1.0)*exp(-d*d*40.)*uShat*2.5;',
' float sr=uShat*1.1;',
' vec3 irid2=.5+.5*cos(TAU*(hue+d*1.2+vec3(0.,.33,.66)));',
' col+=irid2*exp(-pow((d-sr)*6.,2.))*(1.-uShat)*1.4;',
' col+=(h21(p*uRes+uTime)-.5)*.011;',
' o=vec4(col,1.);',
'}'
].join('\n');
const fly=new E.Pool(520);    /* butterfly-shape particles (shape 4) */
const dustp=new E.Pool(420);
let prog=null;
const st={phase:0,timer:0,cx:0,cy:0,charge:0,shat:0};
function geom(){st.cx=E.W*0.5;st.cy=E.H*0.48;}
function flyfn(p,i,dt){
 const s=p.seed[i];
 p.vx[i]+=Math.sin(p.py[i]*0.02+s*40+p.life[i]*6.)*48*E.SC*dt;
 p.vy[i]+=(Math.cos(p.px[i]*0.018+s*30)*30-26)*E.SC*dt;
 p.vx[i]*=Math.exp(-0.9*dt);p.vy[i]*=Math.exp(-0.9*dt);
 p.rot[i]=Math.atan2(p.vy[i],p.vx[i])-Math.PI*0.5+Math.sin(p.life[i]*8.+s*20)*0.4; /* orient to travel + flutter */
}
function shardfn(p,i,dt){p.vx[i]*=Math.exp(-2.4*dt);p.vy[i]*=Math.exp(-2.4*dt);p.vy[i]-=120*E.SC*dt;}
function hueCol(h){return [0.5+0.5*Math.cos(E.TAU*(h+0.00)),0.5+0.5*Math.cos(E.TAU*(h+0.33)),0.5+0.5*Math.cos(E.TAU*(h+0.66))];}
function shatter(){
 st.phase=2;st.timer=0;st.shat=0.001;
 E.flashAdd(.8,1.0,1.0,1.0);E.shakeAdd(14*E.SC);E.setCA(.022);
 for(let i=0;i<170;i++){const a=Math.random()*E.TAU,sp=E.rnd(160,620)*E.SC,h=Math.random();const c=hueCol(h);
  fly.spawn(st.cx,st.cy,Math.cos(a)*sp,Math.sin(a)*sp,E.rnd(1.8,3.2),E.rnd(18,34)*E.SC,c[0],c[1],c[2],E.rnd(.5,.8),4,{rot:a,rv:E.rnd(-1.5,1.5),seed:h});}
 for(let i=0;i<150;i++){const a=Math.random()*E.TAU,sp=E.rnd(500,1700)*E.SC;
  dustp.spawn(st.cx,st.cy,Math.cos(a)*sp,Math.sin(a)*sp,E.rnd(.3,.7),E.rnd(3,7)*E.SC,1.0,1.0,1.0,E.rnd(.5,.85),2,{rot:a,rv:E.rnd(-6,6),drag:2.5,seed:Math.random()});}
}
A.reg({
 id:'FX-146',name:'프리즘 나비 산란',en:'Prismatic Butterfly Scatter',
 desc:'백색 광구가 충전 후 유리처럼 파열 → 실제 나비 문양(전용 입자 셰이프) 입자로 산란. 스펙트럼 전역 색조, 가산혼합 중첩이 백색광 재현, 파열 프레임 색수차 최대. 나비는 진행 방향으로 정렬되며 날갯짓처럼 회전 진동, 날카로운 폭발→유기적 부유.',
 tech:['Dedicated Butterfly Shape','Spectral Per-Particle Hue','Additive→White Recombine','Glass-Shatter Burst','Travel-Aligned Flutter','Max CA at Shatter'],
 bloom:0.88,
 init(){prog=E.U(E.mkProg(E.FS_VERT,FS,'FX146'),['uRes','uC','uTime','uCharge','uShat']);geom();},
 reset(){fly.clear();dustp.clear();st.phase=0;st.timer=0;st.charge=0;st.shat=0;geom();},
 resize(){geom();},
 autoPoint(){return [E.W*0.5,E.H*0.48];},
 trigger(x,y){if(st.phase!==0&&st.phase!==2&&st.phase!==3)return;st.cx=x;st.cy=E.clamp(y,E.H*0.32,E.H*0.66);
  st.phase=1;st.timer=0;st.charge=0;st.shat=0;E.setCA(.003);},
 update(dt,t){
  st.timer+=dt;
  if(st.phase===1){st.charge=E.easeOutCubic(Math.min(1,st.timer/0.9));if(st.timer>0.95)shatter();}
  else if(st.phase===2){st.charge=Math.max(0,st.charge-dt*4.);st.shat=Math.min(1,st.shat+dt*1.6);if(st.timer>1.0){st.phase=3;st.timer=0;}}
  else if(st.phase===3){st.shat=1;if(fly.n===0&&st.timer>0.5){st.phase=0;st.timer=0;st.shat=0;}}
  else{st.charge=Math.max(0,st.charge-dt*2.);}
  fly.update(dt,t,flyfn);dustp.update(dt,t,shardfn);
 },
 drawField(t){if(!prog||!prog.p)return;const g=E.gl;g.useProgram(prog.p);
  g.uniform2f(prog.uRes,E.W,E.H);g.uniform2f(prog.uC,st.cx||E.W*0.5,st.cy||E.H*0.48);
  g.uniform1f(prog.uTime,t);g.uniform1f(prog.uCharge,st.charge);g.uniform1f(prog.uShat,st.shat);E.drawTri();},
 drawParticles(){E.drawPool(fly,E.ADD());E.drawPool(dustp,E.ADD());},
 countParticles(){return fly.n+dustp.n;}
});
})();
(function(){
"use strict";
const A=window.__ARC,E=A.env;
const FS=[
'#version 300 es','precision highp float;','#define TAU 6.2831853',
'uniform vec2 uRes,uC;uniform float uTime,uAlign,uBeam,uBlast,uScorch;',
'out vec4 o;',E.NOISE,
'void main(){',
' float mn=min(uRes.x,uRes.y);',
' vec2 p=(gl_FragCoord.xy-uC)/mn;',
' float d=length(p);float ang=atan(p.y,p.x);',
' vec3 col=mix(vec3(.010,.016,.026),vec3(.001,.003,.009),clamp(d*1.2,0.,1.));',
/* ── hi-tech reticle: diamond frame + rotating ticks + scan sweep (no circles) ── */
' float al=uAlign;',
' vec2 rp=p*mat2(cos(uTime*.6),-sin(uTime*.6),sin(uTime*.6),cos(uTime*.6));',
' float rd=0.50*(1.55-0.6*al);',
' float diamond=exp(-pow((abs(rp.x)+abs(rp.y)-rd)*30.,2.));',          /* rotated-square frame */
' float diamond2=exp(-pow((abs(rp.x)+abs(rp.y)-rd*0.62)*36.,2.));',
' col+=vec3(.0,.95,1.0)*(diamond+diamond2*0.7)*al*0.9;',
' float ticks=0.;',
' for(int k=0;k<4;k++){float ta=float(k)*1.5708+uTime*.6;vec2 tp=vec2(cos(ta),sin(ta))*rd;',
'  ticks+=exp(-dot(p-tp,p-tp)*900.);}',
' col+=vec3(.4,1.0,1.0)*ticks*al*0.8;',
' float sweep=exp(-pow((p.x - sin(uTime*2.2)*rd)*60.,2.))*(1.-smoothstep(rd*0.9,rd,abs(p.y)));',
' col+=vec3(.2,.9,1.0)*sweep*al*0.5;',
' float ch=(exp(-pow(p.x*150.,2.))+exp(-pow(p.y*150.,2.)))*(1.-smoothstep(.0,rd,d));',
' col+=vec3(.5,1.0,1.0)*ch*al*0.35;',
/* ── braided 3-strand plasma laser (sky → impact) ── */
' float up=smoothstep(-0.02,0.05,p.y);',
' float bw=0.020+0.010*(1.-uBeam);',
' float strands=0.;',
' for(int s=0;s<3;s++){float ph=float(s)*2.0944;',
'  float off=sin(p.y*9.-uTime*7.+ph)*0.030*(1.+0.4*sin(p.y*3.2-uTime*2.));',
'  strands+=exp(-pow((p.x-off)/bw,2.));}',
' float crackle=smoothstep(.78,1.,n2(vec2(p.y*40.-uTime*22.,p.x*30.)))*exp(-pow(p.x/(bw*3.),2.));',
' float beam=(strands*(0.5+0.6*fbm2(vec2(p.x*24.,p.y*7.-uTime*9.)))+crackle*1.2)*up*uBeam;',
' col+=vec3(0.4,0.95,1.0)*beam*1.5;',
' col+=vec3(1.0,1.0,1.0)*exp(-pow(p.x/(bw*0.42),2.))*up*uBeam*2.0;',
' col+=vec3(.7,1.0,1.0)*exp(-d*d*30.)*uBeam*1.2;',
/* ── 8-arm star blast + radial ground cracks ── */
' float R=uBlast*1.05;',
' float arms=0.,front=0.;',
' for(int k=0;k<8;k++){float da=float(k)*0.7853982;',
'  float w=pow(max(0.,cos(ang-da)),float(k)==floor(float(k)/2.)*2.?60.:140.);', /* even=wide,odd=narrow */
'  float thick=(mod(float(k),2.)<0.5)?1.0:0.55;',
'  arms+=w*thick*(1.-smoothstep(R*0.55,R,d));',
'  front+=w*thick*exp(-pow((d-R)*7.,2.));}',
' float arm=arms*(0.6+0.6*fbm2(vec2(ang*4.,d*10.-uTime*3.)));',
' float heat=uBlast;',
' vec3 hot=mix(vec3(1.0,.95,.65),vec3(1.0,.36,.05),smoothstep(.0,.55,heat));',
' hot=mix(hot,vec3(.86,.07,.18),smoothstep(.55,1.,heat));',
' col+=hot*arm*(1.0-heat*0.45)*1.5;',
' col+=vec3(1.0,1.0,.92)*front*(1.-heat*.4)*2.2;',
' col+=vec3(1.0,1.0,1.0)*exp(-d*d*55.)*max(uBeam,1.-smoothstep(.0,.25,uBlast))*1.4;',
/* fractal radiating ground cracks (persist as ember scorch) */
' float crk=pow(abs(sin(ang*9.+fbm2(vec2(ang*2.,3.7))*5.)),22.);',
' float crkR=1.-smoothstep(R*0.2,R*1.05,d);',
' float cracks=crk*crkR*(0.4+0.6*fbm2(vec2(d*16.,ang*3.)));',
' col+=vec3(1.0,.32,.06)*cracks*uScorch*1.4;',
' float decal=crk*(1.-smoothstep(.5,1.0,d));',
' col*=1.-decal*uScorch*0.6;',
' col*=1.-0.22*d;',
' col+=(h21(p*uRes+uTime)-.5)*.011;',
' o=vec4(col,1.);',
'}'
].join('\n');
const charge=new E.Pool(420),spark=new E.Pool(760),ember=new E.Pool(520),smoke=new E.Pool(360);
let prog=null;
const st={phase:0,timer:0,cx:0,cy:0,align:0,beam:0,blast:0,scorch:0,R:0,cacc:0};
function geom(){st.cx=E.W*0.5;st.cy=E.H*0.46;st.R=Math.min(E.W,E.H)*0.46;}
function sparkFn(p,i,dt){p.vy[i]-=160*E.SC*dt;p.vx[i]*=Math.exp(-1.1*dt);p.vy[i]*=Math.exp(-1.1*dt);}
function chargeFn(p,i,dt){p.vy[i]+=900*E.SC*dt;p.vx[i]*=Math.exp(-1.5*dt);} /* stream UP into array */
function emberFn(p,i,dt){p.vy[i]+=120*E.SC*dt;p.vx[i]*=Math.exp(-0.6*dt);p.vy[i]*=Math.exp(-0.6*dt);}
function detonate(){
 st.phase=2;st.timer=0;st.beam=0;
 E.flashAdd(.9,.95,1.0,1.0);E.shakeAdd(28*E.SC);E.setCA(.026);
 for(let k=0;k<8;k++){const base=k*Math.PI/4;const thick=(k%2)?0.10:0.20;const cnt=(k%2)?40:80;
  for(let i=0;i<cnt;i++){const a=base+E.rnd(-thick,thick);const sp=E.rnd(280,1600)*E.SC*((k%2)?0.8:1.0);
   spark.spawn(st.cx,st.cy,Math.cos(a)*sp,Math.sin(a)*sp,E.rnd(.4,1.0),E.rnd(3,10)*E.SC,1.0,E.rnd(.4,.8),.12,E.rnd(.6,.9),2,{rot:a,rv:E.rnd(-6,6),seed:Math.random()});}}
 for(let i=0;i<120;i++){const a=Math.random()*E.TAU,sp=E.rnd(60,420)*E.SC;
  ember.spawn(st.cx,st.cy,Math.cos(a)*sp,Math.sin(a)*sp,E.rnd(.8,1.8),E.rnd(2,6)*E.SC,1.0,.5,.1,E.rnd(.5,.8),0,{seed:Math.random()});}
 for(let i=0;i<110;i++){const a=Math.random()*E.TAU,sp=E.rnd(80,500)*E.SC;
  smoke.spawn(st.cx,st.cy,Math.cos(a)*sp,Math.sin(a)*sp,E.rnd(.9,1.8),E.rnd(16,40)*E.SC,.14,.05,.05,E.rnd(.2,.4),3,{seed:Math.random()});}
}
A.reg({
 id:'FX-150',name:'궤도 십자 폭격',en:'Orbital Cross-Strike',
 desc:'고테크 다이아몬드 조준 어레이 + 회전 틱 + 스캔 스윕이 수렴(앤티시페이션 동안 충전 입자가 상공 어레이로 역류)→0프레임 3가닥 땋은 플라즈마 빔 낙하(브레이드 + 마이크로 볼트 크래클)→8갈래 스타 블라스트 + 방사형 프랙탈 지면 균열(엠버 스코치 잔류). 시안/화이트→과열 오렌지/크림슨, 폭심 색수차.',
 tech:['Diamond Reticle + Scan Sweep','Updraft Charge Particles','3-Strand Braided Beam','Micro-Bolt Crackle','8-Arm Star Blast','Fractal Ground Cracks'],
 bloom:0.95,
 init(){prog=E.U(E.mkProg(E.FS_VERT,FS,'FX150'),['uRes','uC','uTime','uAlign','uBeam','uBlast','uScorch']);geom();},
 reset(){charge.clear();spark.clear();ember.clear();smoke.clear();st.phase=0;st.timer=0;st.align=0;st.beam=0;st.blast=0;st.scorch=0;st.cacc=0;geom();},
 resize(){geom();},
 autoPoint(){return [E.W*0.5,E.H*0.46];},
 trigger(x,y){if(st.phase!==0&&st.phase!==3)return;st.cx=x;st.cy=E.clamp(y,E.H*0.34,E.H*0.6);
  st.phase=1;st.timer=0;st.align=0;st.beam=0;st.blast=0;st.scorch=0;st.cacc=0;E.setCA(.003);},
 update(dt,t){
  st.timer+=dt;
  if(st.phase===1){st.align=E.easeOutCubic(Math.min(1,st.timer/1.0));
   st.cacc+=dt*220;while(st.cacc>1&&charge.n<400){st.cacc--;const a=Math.random()*E.TAU,rr=E.rnd(.2,1.0)*st.R;
    charge.spawn(st.cx+Math.cos(a)*rr,st.cy+E.rnd(-20,40)*E.SC,E.rnd(-30,30)*E.SC,E.rnd(-40,40)*E.SC,E.rnd(.3,.7),E.rnd(2,5)*E.SC,.4,.9,1.0,E.rnd(.4,.7),0,{seed:Math.random()});}
   if(st.timer>1.0){st.beam=1;st.phase=2;st.timer=-0.06;charge.clear();}}
  else if(st.phase===2){st.align=Math.max(0,st.align-dt*4.);
   if(st.timer>=0&&st.beam>=1&&st.blast<=0)detonate();
   st.beam=Math.max(0,st.beam-dt*5.);
   if(st.timer>0){st.blast=Math.min(1.05,st.blast+dt*1.7);st.scorch=Math.min(1,st.scorch+dt*3.);}
   if(st.timer>1.4){st.phase=3;st.timer=0;}}
  else if(st.phase===3){st.blast=1.05;st.beam=0;st.scorch=Math.max(0,st.scorch-dt*0.45);
   if(spark.n===0&&ember.n===0&&st.timer>0.6){st.phase=0;st.timer=0;st.blast=0;st.scorch=0;}}
  else{st.align=Math.max(0,st.align-dt*2.);st.scorch=Math.max(0,st.scorch-dt);}
  charge.update(dt,t,chargeFn);spark.update(dt,t,sparkFn);ember.update(dt,t,emberFn);smoke.update(dt,t,null);
 },
 drawField(t){if(!prog||!prog.p)return;const g=E.gl;g.useProgram(prog.p);
  g.uniform2f(prog.uRes,E.W,E.H);g.uniform2f(prog.uC,st.cx||E.W*0.5,st.cy||E.H*0.46);
  g.uniform1f(prog.uTime,t);g.uniform1f(prog.uAlign,st.align);g.uniform1f(prog.uBeam,st.beam);
  g.uniform1f(prog.uBlast,st.blast);g.uniform1f(prog.uScorch,st.scorch);E.drawTri();},
 drawParticles(){E.drawPool(smoke,E.ALPHA());E.drawPool(charge,E.ADD());E.drawPool(spark,E.ADD());E.drawPool(ember,E.ADD());},
 countParticles(){return charge.n+spark.n+ember.n+smoke.n;}
});
})();
(function(){
"use strict";
const A=window.__ARC,E=A.env;
const FS=[
'#version 300 es','precision highp float;','#define TAU 6.2831853',
'uniform vec2 uRes,uC;uniform float uTime,uGlow;',
'out vec4 o;',E.NOISE,
'void main(){',
' float mn=min(uRes.x,uRes.y);',
' vec2 p=(gl_FragCoord.xy-uC)/mn;',
' float d=length(p);',
' vec3 col=mix(vec3(.014,.010,.026),vec3(.002,.002,.010),clamp(d*1.1,0.,1.));',
' col+=vec3(.10,.06,.18)*exp(-d*d*3.0)*(0.4+0.6*uGlow);',                /* breathing core haze */
' float neb=fbm2(p*2.2+vec2(uTime*.05,-uTime*.04));',
' col+=vec3(.05,.03,.10)*neb*neb*(1.-smoothstep(.2,1.1,d));',
' col+=(h21(p*uRes+uTime)-.5)*.010;',
' o=vec4(col,1.);',
'}'
].join('\n');
const N=1500;
const pts=new E.Pool(N),echo=new E.Pool(1100);
const U=new Float32Array(N),V=new Float32Array(N);
let prog=null,seeded=false;
const st={cx:0,cy:0,scale:1,glow:0.5,
 A:1.7,B:1.6,C:0.9,D:0.7, tA:1.7,tB:1.6,tC:0.9,tD:0.7, hue:0.55,thue:0.55, eacc:0, burst:0};
function geom(){st.cx=E.W*0.5;st.cy=E.H*0.52;st.scale=Math.min(E.W,E.H)*0.30;}
function seed(){pts.clear();echo.clear();seeded=true;
 for(let i=0;i<N;i++){U[i]=E.rnd(-1.8,1.8);V[i]=E.rnd(-1.8,1.8);
  pts.spawn(st.cx,st.cy,0,0,1e9,2.4*E.SC,.6,.8,1.0,0.5,0,{seed:i/N});}}
function newParams(){st.tA=E.rnd(-2.0,2.0);st.tB=E.rnd(-2.0,2.0);st.tC=E.rnd(-1.2,1.2);st.tD=E.rnd(-1.2,1.2);st.thue=Math.random();}
function echoFn(p,i,dt){p.vx[i]*=Math.exp(-1.5*dt);p.vy[i]*=Math.exp(-1.5*dt);}
A.reg({
 id:'FX-151',name:'변형 끌개 필리그리',en:'Morphing Attractor Filigree',
 desc:'클리포드 끌개(strange attractor) 맵을 매 프레임 반복 적용해 수천 입자가 카오스 궤적 위를 끓듯이 흐르며 정교한 필리그리 형상을 자발적으로 형성·변형한다. 파라미터가 사인 위상으로 끊임없이 드리프트하여 형상이 살아 호흡하고, 탭하면 목표 파라미터로 점프해 전혀 다른 형상으로 모핑(가산 잔광 트레일·속도 기반 무지갯빛 색조). 원·직선·동심원 없는 창발적 표현.',
 tech:['Clifford Strange Attractor','Per-Frame Chaotic Iteration','Sine-Phase Param Drift','Tap → Morph to New Form','Speed-Hue Iridescence','Additive Echo Trails'],
 bloom:0.7,
 init(){prog=E.U(E.mkProg(E.FS_VERT,FS,'FX151'),['uRes','uC','uTime','uGlow']);geom();seed();},
 reset(){geom();seed();st.A=st.tA=1.7;st.B=st.tB=1.6;st.C=st.tC=0.9;st.D=st.tD=0.7;st.hue=st.thue=0.55;st.glow=0.5;st.burst=0;st.eacc=0;},
 resize(){geom();for(let i=0;i<pts.n;i++){pts.px[i]=st.cx;pts.py[i]=st.cy;}},
 autoPoint(){return [E.W*0.5,E.H*0.52];},
 trigger(x,y){st.cx=E.clamp(x,E.W*0.3,E.W*0.7);st.cy=E.clamp(y,E.H*0.4,E.H*0.62);
  newParams();st.burst=1;st.glow=1.0;E.flashAdd(.35,.6,.5,1.0);E.shakeAdd(8*E.SC);E.setCA(.016);},
 update(dt,t){
  if(!seeded)seed();
  /* ease params toward targets + continuous sine drift */
  const k=1-Math.exp(-dt*2.2);
  st.A=E.lerp(st.A,st.tA,k);st.B=E.lerp(st.B,st.tB,k);st.C=E.lerp(st.C,st.tC,k);st.D=E.lerp(st.D,st.tD,k);
  st.hue=E.lerp(st.hue,st.thue,k);
  const A1=st.A+0.18*Math.sin(t*0.31),B1=st.B+0.18*Math.cos(t*0.27);
  const C1=st.C+0.12*Math.sin(t*0.19),D1=st.D+0.12*Math.cos(t*0.23);
  st.burst=Math.max(0,st.burst-dt*1.5);st.glow=E.lerp(st.glow,0.5,1-Math.exp(-dt*1.2));
  const sc=st.scale,cx=st.cx,cy=st.cy;
  let fastSum=0;
  for(let i=0;i<N;i++){
   const u=U[i],v=V[i];
   const nu=Math.sin(A1*v)+C1*Math.cos(A1*u);
   const nv=Math.sin(B1*u)+D1*Math.cos(B1*v);
   U[i]=nu;V[i]=nv;
   const nx=cx+nu*sc, ny=cy+nv*sc;
   const ox=pts.px[i],oy=pts.py[i];
   const sp=Math.hypot(nx-ox,ny-oy);fastSum+=sp;
   pts.px[i]=nx;pts.py[i]=ny;
   const h=st.hue+0.18*nu+0.10*nv;
   const br=1.15+0.25*st.burst;
   pts.r[i]=Math.min(1,(0.5+0.5*Math.cos(E.TAU*(h)))*br);
   pts.g[i]=Math.min(1,(0.5+0.5*Math.cos(E.TAU*(h+0.33)))*br);
   pts.b[i]=Math.min(1,(0.5+0.5*Math.cos(E.TAU*(h+0.66)))*br);
   pts.a[i]=Math.min(1,0.58+0.55*Math.min(1,sp/(10*E.SC))+0.35*st.burst);
   pts.size[i]=(2.5+2.0*Math.min(1,sp/(15*E.SC)))*E.SC;
  }
  /* echo trails: sample a subset into a decaying pool */
  st.eacc+=dt*900;
  while(st.eacc>1&&echo.n<1050){st.eacc--;const i=(Math.random()*N)|0;
   echo.spawn(pts.px[i],pts.py[i],0,0,E.rnd(.35,.8),pts.size[i]*0.95,pts.r[i],pts.g[i],pts.b[i],0.46,0,{});}
  echo.update(dt,t,echoFn);
 },
 drawField(t){if(!prog||!prog.p)return;const g=E.gl;g.useProgram(prog.p);
  g.uniform2f(prog.uRes,E.W,E.H);g.uniform2f(prog.uC,st.cx||E.W*0.5,st.cy||E.H*0.52);
  g.uniform1f(prog.uTime,t);g.uniform1f(prog.uGlow,st.glow);E.drawTri();},
 drawParticles(){E.drawPool(echo,E.ADD());E.drawPool(pts,E.ADD());},
 countParticles(){return pts.n+echo.n;}
});
})();
(function(){
"use strict";
const A=window.__ARC,E=A.env;
const FS=[
'#version 300 es','precision highp float;','#define TAU 6.2831853',
'uniform vec2 uRes,uC;uniform float uTime,uSpin,uPow,uGlitch,uCollapse;',
'out vec4 o;',E.NOISE,
'void main(){',
' float mn=min(uRes.x,uRes.y);',
' vec2 p=(gl_FragCoord.xy-uC)/mn;',
/* horizontal UV tearing glitch (space breaking) */
' float band=floor(p.y*22.);',
' float tear=(h21(vec2(band,floor(uTime*18.)))-0.5);',
' p.x+=tear*uGlitch*0.16*step(0.6,h21(vec2(band,7.)));',
' float ax=abs(p.x);',
/* funnel width: wide top, narrow bottom; collapse shrinks all */
' float yy=clamp(p.y*0.5+0.5,0.,1.);',
' float width=mix(0.07,0.34,yy)*(1.0-uCollapse);',
' vec3 col=mix(vec3(.020,.0,.030),vec3(.0,.0,.004),clamp(length(p)*1.1,0.,1.));',
/* twisting crimson ribbons via curl-ish noise around the column */
' float twist=p.y*3.2 - uSpin;',
' float r1=fbm2(vec2(p.x*7.+twist, p.y*3.));',
' float r2=fbm2(vec2(p.x*15.-twist*1.6, p.y*6.+uSpin*0.4));',
' float column=1.-smoothstep(width*0.7,width,ax);',
' float ribbons=column*(0.35+0.65*r1)*(0.5+0.5*sin(p.x*40.+twist*2.+r2*6.));',
' ribbons=max(ribbons,0.)*uPow;',
' vec3 red=mix(vec3(.55,.03,.02),vec3(1.0,.0,.0),smoothstep(.2,.9,ribbons));',
' col+=red*ribbons*1.5;',
/* absolute black core down the axis */
' float core=1.-smoothstep(width*0.18,width*0.42,ax);',
' col*=mix(1.,0.,core*column*uPow);',
' col+=vec3(.8,.05,.04)*exp(-pow(ax/(width*0.5),2.))*column*uPow*0.4;',
/* horizontal collapse shockwave */
' float sh=exp(-pow(p.y*9.,2.))*(1.-smoothstep(0.,1.0,ax))*uCollapse;',
' col+=vec3(1.0,.2,.15)*sh*2.2;',
' col+=vec3(1.0,1.0,1.0)*exp(-length(p)*length(p)*60.)*uCollapse*1.5;',
' col*=1.-0.18*length(p);',
' col+=(h21(p*uRes+uTime)-.5)*.013;',
' o=vec4(col,1.);',
'}'
].join('\n');
const debris=new E.Pool(820),smoke=new E.Pool(420);
let prog=null;
const st={phase:0,timer:0,cx:0,cy:0,spin:0,spinV:0,pow:0,glitch:0,collapse:0,acc:0,R:0};
function geom(){st.cx=E.W*0.5;st.cy=E.H*0.5;st.R=Math.min(E.W,E.H)*0.34;}
function swirl(p,i,dt){
 const dx=p.px[i]-st.cx;const r=Math.abs(dx)||1;
 const sw=st.spinV*Math.min(1,st.R/Math.max(Math.hypot(dx,p.py[i]-st.cy),40))*E.SC;
 const sgn=dx<0?1:-1;
 p.vx[i]+=(sgn*sw - dx*2.2)*dt;          /* tangential + pull to axis */
 p.vy[i]+=120*E.SC*dt;                   /* lifted up */
 p.vx[i]*=Math.exp(-0.9*dt);p.vy[i]*=Math.exp(-0.9*dt);
}
A.reg({
 id:'FX-152',name:'시공 단절 와류',en:'Spatial Rend Vortex',
 desc:'원시 에너지의 원통이 공간을 찢어 적·흑 시공 토네이도를 형성. 3D 컬노이즈 풍 트위스트로 크림슨 리본이 축을 감고, 절대흑 코어가 관통. 느린 시작→지수 가속 고RPM→단일점 붕괴→수평 충격파. 수평 UV 티어링(글리치)으로 공간 파열, 색수차 가중.',
 tech:['Twisting Crimson Ribbons','Absolute-Black Axis Core','Horizontal UV Tearing Glitch','Exponential Spin-Up','Point Collapse → H-Shockwave','Axis-Pull Debris'],
 bloom:0.82,
 init(){prog=E.U(E.mkProg(E.FS_VERT,FS,'FX152'),['uRes','uC','uTime','uSpin','uPow','uGlitch','uCollapse']);geom();},
 reset(){debris.clear();smoke.clear();st.phase=0;st.timer=0;st.spin=0;st.spinV=0;st.pow=0;st.glitch=0;st.collapse=0;st.acc=0;geom();},
 resize(){geom();},
 autoPoint(){return [E.W*0.5,E.H*0.5];},
 trigger(x,y){if(st.phase!==0&&st.phase!==2)return;st.cx=x;st.cy=E.clamp(y,E.H*0.4,E.H*0.6);
  st.phase=1;st.timer=0;st.spinV=2.0;st.pow=0;st.glitch=0;st.collapse=0;E.setCA(.005);},
 update(dt,t){
  st.timer+=dt;
  if(st.phase===1){
   st.pow=Math.min(1,st.pow+dt*1.4);
   st.spinV=Math.min(34.,st.spinV*Math.exp(dt*1.5)); /* exponential accel */
   st.glitch=Math.min(1,st.glitch+dt*0.6);
   st.acc+=dt*180;while(st.acc>1&&debris.n<780){st.acc--;const a=Math.random()*E.TAU,rr=st.R*E.rnd(.6,1.1);
    const x=st.cx+Math.cos(a)*rr,y=st.cy+Math.sin(a)*rr*0.8;
    debris.spawn(x,y,0,0,E.rnd(.7,1.6),E.rnd(3,9)*E.SC,E.rnd(.7,1.0),.05,.04,E.rnd(.4,.7),2,{rot:a,rv:E.rnd(-8,8),seed:Math.random()});
    if(debris.n%4===0&&smoke.n<400)smoke.spawn(x,y,0,0,E.rnd(1.0,2.0),E.rnd(12,26)*E.SC,.18,.02,.04,E.rnd(.12,.24),3,{seed:Math.random()});}
   if(st.timer>3.0){st.phase=2;st.timer=0;st.collapse=0.001;E.shakeAdd(28*E.SC);E.setCA(.026);E.flashAdd(.55,1.0,.2,.15);}}
  else if(st.phase===2){
   st.collapse=Math.min(1,st.collapse+dt*2.4);st.spinV=E.lerp(st.spinV,0,1-Math.exp(-dt*7.));
   st.pow=Math.max(0,st.pow-dt*1.2);st.glitch=Math.max(0,st.glitch-dt*1.4);
   if(st.collapse>0.4){for(let i=0;i<debris.n;i++){debris.vx[i]+=(debris.px[i]-st.cx>0?1:-1)*900*E.SC*dt;}}
   if(st.timer>1.4){st.phase=0;st.timer=0;st.collapse=0;}}
  else{st.pow=Math.max(0,st.pow-dt*1.2);st.spinV=E.lerp(st.spinV,0,1-Math.exp(-dt*3.));st.glitch=Math.max(0,st.glitch-dt);}
  st.spin+=st.spinV*dt;
  debris.update(dt,t,swirl);smoke.update(dt,t,swirl);
 },
 drawField(t){if(!prog||!prog.p)return;const g=E.gl;g.useProgram(prog.p);
  g.uniform2f(prog.uRes,E.W,E.H);g.uniform2f(prog.uC,st.cx||E.W*0.5,st.cy||E.H*0.5);
  g.uniform1f(prog.uTime,t);g.uniform1f(prog.uSpin,st.spin);g.uniform1f(prog.uPow,st.pow);
  g.uniform1f(prog.uGlitch,st.glitch);g.uniform1f(prog.uCollapse,st.collapse);E.drawTri();},
 drawParticles(){E.drawPool(smoke,E.ALPHA());E.drawPool(debris,E.ADD());},
 countParticles(){return debris.n+smoke.n;}
});
})();
(function(){
"use strict";
const A=window.__ARC,E=A.env;
const FS=[
'#version 300 es','precision highp float;','#define TAU 6.2831853',
'uniform vec2 uRes,uC;uniform float uTime,uRing,uBeam,uExpo;',
'out vec4 o;',E.NOISE,
'void main(){',
' float mn=min(uRes.x,uRes.y);',
' vec2 p=(gl_FragCoord.xy-uC)/mn;',
' vec3 col=mix(vec3(.010,.006,.022),vec3(.002,.001,.008),clamp(length(p)*1.1,0.,1.));',
/* sky ring (torus) high above impact, expands */
' vec2 rp=p-vec2(0.0,0.62);',
' float rr=length(vec2(rp.x*0.7,rp.y));',
' float RR=0.10+0.42*uRing;',
' float ringSDF=exp(-pow((rr-RR)*(10.+8.*uRing),2.));',
' vec3 cool=mix(vec3(.0,.0,.55),vec3(.3,.1,.9),uRing);',
' col+=cool*ringSDF*(0.6+0.6*uRing);',
' col+=cool*exp(-rr*rr*5.)*uRing*0.3;',
/* volumetric mega-laser column: magenta, perlin roar, white core */
' float bw=0.16;',
' float roar=fbm2(vec2(p.x*9.,p.y*5.-uTime*7.))*0.6+fbm2(vec2(p.x*22.+uTime*3.,p.y*9.))*0.4;',
' float colmn=exp(-pow(p.x/bw,2.));',
' float beam=colmn*(0.4+0.9*roar)*uBeam;',
' vec3 mag=mix(vec3(1.0,.2,1.0),vec3(1.0,.45,.78),roar);',
' col+=mag*beam*1.8;',
' col+=vec3(1.0,1.0,1.0)*exp(-pow(p.x/(bw*0.42),2.))*uBeam*2.4;',
/* heat haze ripple near beam */
' float haze=sin(p.y*60.-uTime*10.+roar*6.)*0.5+0.5;',
' col+=mag*colmn*haze*uBeam*0.25;',
/* impact bloom on floor */
' col+=vec3(1.0,.5,1.0)*exp(-length(p)*length(p)*22.)*uBeam*1.4;',
/* exposure blow-out to white at peak */
' col+=vec3(1.0,1.0,1.0)*uExpo*2.2;',
' col*=1.-0.2*length(p);',
' col+=(h21(p*uRes+uTime)-.5)*.011;',
' o=vec4(col,1.);',
'}'
].join('\n');
const scat=new E.Pool(760),spark=new E.Pool(420);
let prog=null;
const st={phase:0,timer:0,cx:0,cy:0,ring:0,beam:0,expo:0};
function geom(){st.cx=E.W*0.5;st.cy=E.H*0.42;}
function scatFn(p,i,dt){p.vy[i]+=70*E.SC*dt;p.vx[i]*=Math.exp(-1.0*dt);p.vy[i]*=Math.exp(-1.0*dt);}
function fire(){
 st.beam=1;E.flashAdd(1.0,1.0,.8,1.0);E.shakeAdd(22*E.SC);E.setCA(.022);
 for(let i=0;i<160;i++){const a=E.rnd(0,Math.PI);const sp=E.rnd(220,1100)*E.SC;
  scat.spawn(st.cx+E.rnd(-30,30)*E.SC,st.cy,Math.cos(a)*sp,Math.abs(Math.sin(a))*sp*0.4+E.rnd(20,120)*E.SC,E.rnd(.4,1.0),E.rnd(3,9)*E.SC,1.0,E.rnd(.3,.6),1.0,E.rnd(.6,.9),2,{rot:a,rv:E.rnd(-6,6),seed:Math.random()});}
}
A.reg({
 id:'FX-153',name:'행성 고리 섬멸 광선',en:'Planetary Ring Mega-Laser',
 desc:'거대 코스믹 고리가 하늘에서 2초간 우아하게 확장(토러스 SDF)→0프레임 즉발 마젠타 메가레이저(볼류메트릭 펄린 노이즈 포효)가 바닥 소각. HDR 화이트 코어·히트헤이즈·가산혼합 과열감, 정점에서 노출 폭주(스크린 화이트아웃) 후 알파 감쇠 번아웃. 고주파 X축 카메라 셰이크.',
 tech:['Expanding Torus Ring SDF','Volumetric Magenta Beam','Layered Perlin Roar','HDR White Core','Heat-Haze Ripple','Exposure Blow-Out (whiteout)'],
 bloom:0.98,
 init(){prog=E.U(E.mkProg(E.FS_VERT,FS,'FX153'),['uRes','uC','uTime','uRing','uBeam','uExpo']);geom();},
 reset(){scat.clear();spark.clear();st.phase=0;st.timer=0;st.ring=0;st.beam=0;st.expo=0;geom();},
 resize(){geom();},
 autoPoint(){return [E.W*0.5,E.H*0.42];},
 trigger(x,y){if(st.phase!==0&&st.phase!==3)return;st.cx=x;st.cy=E.clamp(y,E.H*0.34,E.H*0.55);
  st.phase=1;st.timer=0;st.ring=0;st.beam=0;st.expo=0;E.setCA(.003);},
 update(dt,t){
  st.timer+=dt;
  if(st.phase===1){st.ring=E.easeOutQuart(Math.min(1,st.timer/2.0));if(st.timer>2.0){st.phase=2;st.timer=0;fire();st.expo=1;}}
  else if(st.phase===2){
   st.expo=Math.max(0,st.expo-dt*3.5);st.ring=Math.max(0,st.ring-dt*0.8);
   st.beam=0.85+0.15*Math.sin(t*40.); /* high-freq flicker while firing */
   if(st.timer>0.9){st.phase=3;st.timer=0;}}
  else if(st.phase===3){st.beam=Math.max(0,st.beam-dt*1.4);st.ring=Math.max(0,st.ring-dt);
   if(st.beam<0.02&&scat.n===0&&st.timer>0.4){st.phase=0;st.timer=0;st.beam=0;}}
  else{st.ring=Math.max(0,st.ring-dt);st.beam=Math.max(0,st.beam-dt*2.);st.expo=Math.max(0,st.expo-dt*3.);}
  scat.update(dt,t,scatFn);spark.update(dt,t,null);
 },
 drawField(t){if(!prog||!prog.p)return;const g=E.gl;g.useProgram(prog.p);
  g.uniform2f(prog.uRes,E.W,E.H);g.uniform2f(prog.uC,st.cx||E.W*0.5,st.cy||E.H*0.42);
  g.uniform1f(prog.uTime,t);g.uniform1f(prog.uRing,st.ring);g.uniform1f(prog.uBeam,st.beam);g.uniform1f(prog.uExpo,st.expo);E.drawTri();},
 drawParticles(){E.drawPool(scat,E.ADD());E.drawPool(spark,E.ADD());},
 countParticles(){return scat.n+spark.n;}
});
})();
(function(){
"use strict";
const A=window.__ARC,E=A.env;
const FS=[
'#version 300 es','precision highp float;','#define TAU 6.2831853',
'uniform vec2 uRes,uC;uniform float uTime,uDeploy,uWave,uYsq;',
'out vec4 o;',E.NOISE,
'void main(){',
' float mn=min(uRes.x,uRes.y);',
' vec2 fc=(gl_FragCoord.xy-uC)/mn;',
' vec3 col=mix(vec3(.004,.010,.028),vec3(.001,.002,.010),clamp(fc.y*.55+.5,0.,1.));',
' vec2 gp=vec2(fc.x,fc.y/uYsq);',
' float d=length(gp);',
' float reveal=1.-smoothstep(0.95*uDeploy,0.95*uDeploy+0.06,d);',
' float gate=reveal*smoothstep(0.,.10,uDeploy);',
' float S=5.0;',
' vec2 cell=gp*S;vec2 gg=abs(fract(cell)-0.5);',
' float lineX=1.-smoothstep(.0,.045,gg.y);',                        /* horizontal traces */
' float lineY=1.-smoothstep(.0,.045,gg.x);',                        /* vertical traces */
' float lineMask=max(lineX,lineY);',
/* travelling energy packets along traces */
' float pkX=pow(fract(cell.x*0.5 - uTime*0.9),10.)*lineX;',
' float pkY=pow(fract(cell.y*0.5 - uTime*0.7),10.)*lineY;',
' float packets=(pkX+pkY);',
/* nodes at intersections pulse */
' float node=exp(-dot(gg,gg)*60.)*(0.5+0.5*sin(uTime*4.+floor(cell.x)+floor(cell.y)));',
/* ignition cascade flooding the lattice along its traces */
' float wf=uWave;',
' float passed=1.-smoothstep(wf,wf+0.05,d);',
' float frontGlow=exp(-pow((d-wf)*7.,2.));',
' float jag=pow(abs(sin(atan(gp.y,gp.x)*16.+fbm2(vec2(atan(gp.y,gp.x)*3.,uTime*5.))*4.)),18.)*frontGlow;',
' float ignite=lineMask*(passed*0.6+frontGlow*1.6)+node*passed*1.2+jag*1.4;',
/* base hologram + ignition recolor */
' vec3 baseC=mix(vec3(.0,.30,1.0),vec3(.0,.95,1.0),packets);',
' col+=baseC*(lineMask*0.30+packets*1.4+node*0.5)*gate;',
' vec3 hotC=mix(vec3(.1,.7,1.0),vec3(1.0,.4,1.0),smoothstep(.3,1.,frontGlow))+vec3(.6,.6,.6)*frontGlow;',
' col+=hotC*ignite*gate*1.3;',
' col+=vec3(1.0,1.0,1.0)*exp(-d*d*30.)*smoothstep(.0,.2,wf)*0.8;',
' col*=1.-0.2*length(fc);',
' col+=(h21(fc*uRes+uTime)-.5)*.011;',
' o=vec4(col,1.);',
'}'
].join('\n');
const token=new E.Pool(360),nodspk=new E.Pool(620),bolt=new E.Pool(420);
let prog=null;const YSQ=0.5,GS=5.0;
const nodes=[]; /* {gx,gy,px,py,fired} */
const st={phase:0,timer:0,cx:0,cy:0,deploy:0,wave:0,R:0};
function geom(){st.cx=E.W*0.5;st.cy=E.H*0.52;st.R=Math.min(E.W,E.H)*0.45;buildNodes();}
function buildNodes(){nodes.length=0;const span=1.6;
 for(let iy=-3;iy<=3;iy++)for(let ix=-3;ix<=3;ix++){const gx=ix/GS,gy=iy/GS;
  if(Math.hypot(gx,gy)>0.85)continue;
  nodes.push({gx,gy,px:st.cx+gx*st.R,py:st.cy+gy*st.R*YSQ,fired:false,dn:Math.hypot(gx,gy)/(YSQ<1?1:1)});}}
function tokenFn(p,i,dt){if(st.phase===2){p.vy[i]-=200*E.SC*dt;p.vx[i]*=Math.exp(-0.9*dt);p.vy[i]*=Math.exp(-0.9*dt);}else{p.vx[i]*=Math.exp(-6.*dt);p.vy[i]*=Math.exp(-6.*dt);}}
function deploy(){st.phase=1;st.timer=0;st.wave=0;buildNodes();
 E.flashAdd(.2,.0,.5,.9);E.shakeAdd(5*E.SC);
 for(const nd of nodes){if(Math.random()>0.45)continue;nd.fired=false;
  token.spawn(nd.px,nd.py,0,0,99,E.rnd(8,15)*E.SC,.2,.95,1.0,0.0,2,{rot:E.rnd(0,E.TAU),rv:E.rnd(-1,1),seed:E.rnd(0,0.5)});}}
A.reg({
 id:'FX-154',name:'회로 격자 캐스케이드',en:'Circuit Lattice Cascade',
 desc:'원근 홀로그램 회로 격자 위로 에너지 패킷이 트레이스를 따라 흐르고 노드가 맥동(이즈아웃 전개). 트리거 시 점화 파면이 격자 위상(토폴로지)을 따라 전류처럼 번져 트레이스와 노드를 순차 점등시키는 창발적 캐스케이드(방사형 단순 뇌전 아님). 시안→마젠타/화이트 전이, 파면 통과 시 노드 스파크 점화·토큰 파편 산화.',
 tech:['Perspective Circuit Grid','Travelling Packets on Traces','Topology-Following Ignition Flood','Wavefront-Triggered Node Sparks','Cyan→Magenta Transition','Spring Tokens + Physics Burst'],
 bloom:0.9,
 init(){prog=E.U(E.mkProg(E.FS_VERT,FS,'FX154'),['uRes','uC','uTime','uDeploy','uWave','uYsq']);geom();},
 reset(){token.clear();nodspk.clear();bolt.clear();st.phase=0;st.timer=0;st.deploy=0;st.wave=0;geom();},
 resize(){geom();},
 autoPoint(){return [E.W*0.5,E.H*0.52];},
 trigger(x,y){if(st.phase!==0&&st.phase!==3)return;st.cx=x;st.cy=E.clamp(y,E.H*0.4,E.H*0.62);
  st.phase=1;st.timer=0;st.deploy=0;st.wave=0;deploy();E.setCA(.003);},
 update(dt,t){
  st.timer+=dt;
  if(st.phase===1){st.deploy=E.easeOutCubic(Math.min(1,st.timer/0.9));
   for(let i=0;i<token.n;i++){const u=E.clamp((st.timer-token.seed[i])/0.5,0,1);token.a[i]=E.easeOutBack(u)*0.9;}
   if(st.timer>1.5){st.phase=2;st.timer=0;st.wave=0.001;E.shakeAdd(20*E.SC);E.setCA(.020);E.flashAdd(.5,.3,.7,1.0);}}
  else if(st.phase===2){
   st.wave+=dt*1.0;
   /* ignite nodes as wavefront passes (topology cascade) */
   for(const nd of nodes){if(!nd.fired&&nd.dn<=st.wave){nd.fired=true;
    for(let s=0;s<5;s++){const a=Math.random()*E.TAU,sp=E.rnd(60,260)*E.SC;
     nodspk.spawn(nd.px,nd.py,Math.cos(a)*sp,Math.sin(a)*sp,E.rnd(.3,.7),E.rnd(2,5)*E.SC,.6,.95,1.0,E.rnd(.6,.9),0,{drag:2.,seed:Math.random()});}
    if(bolt.n<400){const a=Math.random()*E.TAU,sp=E.rnd(200,700)*E.SC;
     bolt.spawn(nd.px,nd.py,Math.cos(a)*sp,Math.sin(a)*sp,E.rnd(.15,.35),E.rnd(2,5)*E.SC,1.0,.4,1.0,E.rnd(.6,.9),0,{seed:Math.random()});}}}
   /* tokens reached by wave burst outward */
   for(let i=0;i<token.n;i++){const tg=Math.hypot((token.px[i]-st.cx)/st.R,(token.py[i]-st.cy)/(st.R*YSQ));
    if(tg<=st.wave&&token.maxLife[i]>1e8){const ang=Math.atan2(token.py[i]-st.cy,token.px[i]-st.cx);const sp=E.rnd(250,900)*E.SC;
     token.vx[i]=Math.cos(ang)*sp;token.vy[i]=Math.sin(ang)*sp+E.rnd(80,260)*E.SC;token.life[i]=E.rnd(0.6,1.3);token.maxLife[i]=token.life[i];token.rv[i]=E.rnd(-8,8);}}
   if(st.wave>1.4){st.phase=3;st.timer=0;}}
  else if(st.phase===3){st.deploy=Math.max(0,st.deploy-dt*1.4);st.wave=Math.min(1.6,st.wave+dt*0.4);
   if(token.n===0&&nodspk.n===0&&st.timer>0.4){st.phase=0;st.timer=0;st.deploy=0;st.wave=0;}}
  else{st.deploy=Math.max(0,st.deploy-dt);}
  token.update(dt,t,tokenFn);nodspk.update(dt,t,null);bolt.update(dt,t,null);
 },
 drawField(t){if(!prog||!prog.p)return;const g=E.gl;g.useProgram(prog.p);
  g.uniform2f(prog.uRes,E.W,E.H);g.uniform2f(prog.uC,st.cx||E.W*0.5,st.cy||E.H*0.52);
  g.uniform1f(prog.uTime,t);g.uniform1f(prog.uDeploy,st.deploy);g.uniform1f(prog.uWave,st.wave);g.uniform1f(prog.uYsq,YSQ);E.drawTri();},
 drawParticles(){E.drawPool(token,E.ADD());E.drawPool(nodspk,E.ADD());E.drawPool(bolt,E.ADD());},
 countParticles(){return token.n+nodspk.n+bolt.n;}
});
})();
(function(){
"use strict";
const A=window.__ARC,E=A.env;
const FS=[
'#version 300 es','precision highp float;','#define TAU 6.2831853',
'uniform vec2 uRes,uC;uniform float uTime,uEmit;',
'out vec4 o;',E.NOISE,
'void main(){',
' float mn=min(uRes.x,uRes.y);',
' vec2 p=(gl_FragCoord.xy-uC)/mn;',
' float d=length(p);',
' vec3 col=mix(vec3(.018,.014,.026),vec3(.002,.003,.010),clamp(d*1.1,0.,1.));',
/* faint flow streaks hinting the curl field */
' float fl=fbm2(vec2(p.x*4.+uTime*.2,p.y*2.-uTime*.6));',
' col+=vec3(.06,.05,.10)*fl*fl*(1.-smoothstep(.2,1.1,d));',
/* warm launch glow at source (bottom) */
' vec2 sp=p-vec2(0.0,-0.42);',
' col+=vec3(.9,.5,.8)*exp(-dot(sp,sp)*22.)*uEmit*0.7;',
' col+=(h21(p*uRes+uTime)-.5)*.010;',
' o=vec4(col,1.);',
'}'
].join('\n');
const fly=new E.Pool(720),trail=new E.Pool(1000),poof=new E.Pool(360);
let prog=null;
const st={cx:0,cy:0,sx:0,sy:0,emit:0,waveT:0,wavesLeft:0,targetY:0};
function geom(){st.cx=E.W*0.5;st.cy=E.H*0.5;st.sx=E.W*0.5;st.sy=E.H*0.18;st.targetY=E.H*0.86;}
function hueCol(h){return [0.5+0.5*Math.cos(E.TAU*h),0.5+0.5*Math.cos(E.TAU*(h+0.33)),0.5+0.5*Math.cos(E.TAU*(h+0.66))];}
function flyFn(p,i,dt){
 const s=p.seed[i];const sc=0.006;
 const c=E.curl2(p.px[i]*sc,p.py[i]*sc,s*10+0.3);
 p.vx[i]+=c[0]*260*E.SC*dt;
 p.vy[i]+=(c[1]*180+170)*E.SC*dt;                 /* curl drift + forward(up) thrust */
 const hy=(st.targetY-p.py[i]);p.vy[i]+=E.clamp(hy,-200,200)*0.4*dt; /* mild homing to target band */
 p.vx[i]*=Math.exp(-1.1*dt);p.vy[i]*=Math.exp(-1.1*dt);
 p.rot[i]=Math.atan2(p.vy[i],p.vx[i])-Math.PI*0.5+Math.sin(p.life[i]*10.+s*20)*0.45;
}
function poofFn(p,i,dt){p.vx[i]*=Math.exp(-2.5*dt);p.vy[i]*=Math.exp(-2.5*dt);}
function launchWave(n){
 for(let i=0;i<n&&fly.n<700;i++){const h=Math.random();const c=hueCol(h);
  const ang=-Math.PI*0.5+E.rnd(-0.5,0.5);const spd=E.rnd(260,520)*E.SC;
  fly.spawn(st.sx+E.rnd(-30,30)*E.SC,st.sy+E.rnd(-12,12)*E.SC,Math.cos(ang)*spd,-Math.sin(ang)*spd,E.rnd(1.6,2.6),E.rnd(15,28)*E.SC,c[0],c[1],c[2],E.rnd(.55,.85),4,{rot:Math.PI*0.5,rv:E.rnd(-1,1),seed:h});}
 st.emit=1;E.flashAdd(.18,.7,.5,.9);E.shakeAdd(5*E.SC);E.setCA(.006);
}
A.reg({
 id:'FX-155',name:'나비 탄막',en:'Butterfly Barrage',
 desc:'발사원에서 나비 형태(전용 셰이프) 투사체가 파상으로 발사되어 컬노이즈 흐름장을 따라 유기적으로 굽이치며 비행, 표적대를 향해 약하게 호밍한다. 직선이 아닌 창발적 곡선 궤적·날갯짓 회전 진동·무지갯빛 색조·가산 잔광 트레일. 명중 시 작은 인분(鱗粉) 산포.',
 tech:['Butterfly-Shape Projectiles','Curl-Field Organic Flight','Mild Target Homing','Flutter Orientation','Iridescent Hue','Scale-Dust Poof on Expiry'],
 bloom:0.9,
 init(){prog=E.U(E.mkProg(E.FS_VERT,FS,'FX155'),['uRes','uC','uTime','uEmit']);geom();},
 reset(){fly.clear();trail.clear();poof.clear();st.emit=0;st.waveT=0;st.wavesLeft=0;geom();},
 resize(){geom();},
 autoPoint(){return [st.sx,st.sy];},
 trigger(x,y){st.sx=E.clamp(x,E.W*0.2,E.W*0.8);st.sy=E.clamp(y,E.H*0.1,E.H*0.4);st.targetY=E.H*0.9;
  st.wavesLeft=4;st.waveT=0;launchWave(34);},
 update(dt,t){
  st.emit=Math.max(0,st.emit-dt*1.6);
  if(st.wavesLeft>0){st.waveT-=dt;if(st.waveT<=0){st.waveT=0.22;st.wavesLeft--;launchWave(28);}}
  /* trails + expiry poof */
  for(let i=0;i<fly.n;i++){
   if((i&1)===0&&trail.n<980)trail.spawn(fly.px[i]-fly.vx[i]*0.012,fly.py[i]-fly.vy[i]*0.012,0,0,E.rnd(.2,.4),E.rnd(4,8)*E.SC,fly.r[i],fly.g[i],fly.b[i],0.3,0,{});
   if(fly.life[i]<0.12&&poof.n<340&&Math.random()<0.3){const a=Math.random()*E.TAU,sp=E.rnd(30,120)*E.SC;
    poof.spawn(fly.px[i],fly.py[i],Math.cos(a)*sp,Math.sin(a)*sp,E.rnd(.2,.5),E.rnd(2,5)*E.SC,fly.r[i],fly.g[i],fly.b[i],0.5,0,{});}
  }
  fly.update(dt,t,flyFn);trail.update(dt,t,poofFn);poof.update(dt,t,poofFn);
 },
 drawField(t){if(!prog||!prog.p)return;const g=E.gl;g.useProgram(prog.p);
  g.uniform2f(prog.uRes,E.W,E.H);g.uniform2f(prog.uC,st.sx||E.W*0.5,st.sy||E.H*0.5);
  g.uniform1f(prog.uTime,t);g.uniform1f(prog.uEmit,st.emit);E.drawTri();},
 drawParticles(){E.drawPool(trail,E.ADD());E.drawPool(poof,E.ADD());E.drawPool(fly,E.ADD());},
 countParticles(){return fly.n+trail.n+poof.n;}
});
})();
(function(){
"use strict";
const A=window.__ARC,E=A.env;
const NP=6;
const FS=[
'#version 300 es','precision highp float;','#define TAU 6.2831853',
'uniform vec2 uRes,uC;uniform float uTime,uSummon;uniform float uPillA[6];uniform float uPillX[6];uniform float uFloor;',
'out vec4 o;',E.NOISE,
'void main(){',
' float mn=min(uRes.x,uRes.y);',
' vec2 p=(gl_FragCoord.xy-uC)/mn;',
' vec3 col=mix(vec3(.040,.028,.006),vec3(.010,.007,.002),clamp(length(p)*1.1,0.,1.));',
/* high summoning arc (subtle, overhead) */
' float ay=p.y-0.42;',
' float arc=exp(-pow((length(vec2(p.x*0.8,ay))-0.5)*16.,2.))*smoothstep(0.,1.,p.y);',
' col+=vec3(1.0,.84,.34)*arc*uSummon*0.8;',
' float spokes=pow(abs(sin(atan(ay,p.x)*10.)),24.)*arc;',
' col+=vec3(1.0,.92,.6)*spokes*uSummon*0.6;',
/* holy light pillars at impacts */
' for(int k=0;k<6;k++){float pa=uPillA[k];if(pa<0.001)continue;',
'  float dx=p.x-uPillX[k];',
'  float pill=exp(-pow(dx/0.045,2.))*smoothstep(uFloor-0.02,uFloor+0.6,p.y)*(1.-smoothstep(0.0,1.4,p.y-uFloor));',
'  col+=vec3(1.0,.92,.6)*pill*pa*1.8;',
'  col+=vec3(1.0,1.0,.9)*exp(-pow(dx/0.012,2.))*smoothstep(uFloor,uFloor+0.3,p.y)*pa*1.5;',
'  col+=vec3(1.0,.8,.4)*exp(-dot(p-vec2(uPillX[k],uFloor),p-vec2(uPillX[k],uFloor))*40.)*pa;',
' }',
' col*=1.-0.18*length(p);',
' col+=(h21(p*uRes+uTime)-.5)*.010;',
' o=vec4(col,1.);',
'}'
].join('\n');
const lance=new E.Pool(360),trail=new E.Pool(1000),cross=new E.Pool(620),feath=new E.Pool(360);
let prog=null;
const st={cx:0,cy:0,summon:0,floorY:0,acc:0,fireT:0,pill:[]};
function geom(){st.cx=E.W*0.5;st.cy=E.H*0.5;st.floorY=E.H*0.30;}
function lanceFn(p,i,dt){
 const s=p.seed[i];p.vy[i]-=1400*E.SC*dt;                 /* gravity accel downward */
 p.vx[i]+=Math.sin(p.py[i]*0.01+s*12)*60*E.SC*dt;          /* slight curl drift */
 p.rot[i]=Math.atan2(p.vy[i],p.vx[i])+Math.PI*0.5;          /* point along travel */
}
function fade(p,i,dt){p.vx[i]*=Math.exp(-2.5*dt);p.vy[i]*=Math.exp(-2.5*dt);}
function impact(x){
 for(let s=0;s<4;s++){const base=s*Math.PI*0.5+Math.PI*0.25;
  for(let i=0;i<14;i++){const a=base+E.rnd(-0.14,0.14),sp=E.rnd(120,560)*E.SC;
   cross.spawn(x,st.floorY,Math.cos(a)*sp,Math.sin(a)*sp,E.rnd(.3,.7),E.rnd(3,8)*E.SC,1.0,.9,.5,E.rnd(.6,.9),2,{rot:a,rv:E.rnd(-5,5),seed:Math.random()});}}
 for(let i=0;i<14;i++){feath.spawn(x+E.rnd(-20,20)*E.SC,st.floorY+E.rnd(0,30)*E.SC,E.rnd(-40,40)*E.SC,E.rnd(60,180)*E.SC,E.rnd(.8,1.6),E.rnd(8,16)*E.SC,1.0,.92,.6,E.rnd(.3,.6),1,{rot:E.rnd(0,E.TAU),rv:E.rnd(-2,2)});}
 /* register a light pillar */
 const nx=(x-st.cx)/Math.min(E.W,E.H);
 st.pill.push({x:nx,a:1});if(st.pill.length>NP)st.pill.shift();
 E.flashAdd(.5,1.0,.85,.55);E.shakeAdd(12*E.SC);E.setCA(.012);
}
function volley(){st.fireT=1.0;st.summon=1;st.acc=0;E.flashAdd(.3,1.0,.85,.4);}
A.reg({
 id:'FX-156',name:'세라프의 빛창 강림',en:'Seraphic Lance Rain',
 desc:'상공 소환진 아크에서 황금 빛의 창(랜스)들이 정렬·점멸 후 가속 강하하는 신성 투사체 군집. 각 창은 약한 컬 드리프트로 휘며 진행 방향으로 정렬, 지면 명중 시 십자 스파크 비산 + 수직 홀리 광주(光柱) 점등 + 깃털 부유. 절대 신성 골드 단색조, 인물 묘사 없이 투사체·광주·아크로 신열감 구성.',
 tech:['Overhead Summon Arc','Accelerating Light Lances','Curl-Drift Guidance','Cross-Spark Impacts','Vertical Holy Pillars (uniform array)','Drifting Feathers'],
 bloom:0.93,
 init(){prog=E.U(E.mkProg(E.FS_VERT,FS,'FX156'),['uRes','uC','uTime','uSummon','uPillA','uPillX','uFloor']);geom();},
 reset(){lance.clear();trail.clear();cross.clear();feath.clear();st.summon=0;st.acc=0;st.fireT=0;st.pill=[];geom();},
 resize(){geom();},
 autoPoint(){return [E.W*0.5,E.H*0.5];},
 trigger(x,y){st.cx=E.clamp(x,E.W*0.3,E.W*0.7);st.floorY=E.clamp(y,E.H*0.22,E.H*0.4);volley();},
 update(dt,t){
  st.summon=Math.max(0,st.summon-dt*0.5);
  for(const pl of st.pill)pl.a=Math.max(0,pl.a-dt*1.1);
  if(st.fireT>0){st.fireT-=dt;st.acc+=dt*26;
   while(st.acc>1&&lance.n<340){st.acc--;
    const lx=st.cx+E.rnd(-1,1)*Math.min(E.W,E.H)*0.42;
    const ly=st.cy+Math.min(E.W,E.H)*0.46+E.rnd(0,Math.min(E.W,E.H)*0.1);
    lance.spawn(lx,ly,E.rnd(-30,30)*E.SC,E.rnd(-60,-20)*E.SC,2.2,E.rnd(16,28)*E.SC,1.0,.92,.55,E.rnd(.7,.95),2,{rot:Math.PI,rv:0,seed:Math.random()});}
  }
  /* trails + floor impacts */
  for(let i=lance.n-1;i>=0;i--){
   if(trail.n<980)trail.spawn(lance.px[i],lance.py[i]+12*E.SC,0,0,E.rnd(.2,.4),E.rnd(4,9)*E.SC,1.0,.88,.5,0.4,0,{});
   if(lance.py[i]<=st.floorY){impact(lance.px[i]);lance.life[i]=0;}
  }
  lance.update(dt,t,lanceFn);trail.update(dt,t,fade);cross.update(dt,t,(p,i,dd)=>{p.vy[i]-=140*E.SC*dd;p.vx[i]*=Math.exp(-1.4*dd);p.vy[i]*=Math.exp(-1.4*dd);});
  feath.update(dt,t,(p,i,dd)=>{p.vy[i]-=60*E.SC*dd;p.vx[i]+=Math.sin(p.py[i]*0.03+p.seed[i]*9)*30*E.SC*dd;p.vx[i]*=Math.exp(-1.0*dd);});
 },
 drawField(t){if(!prog||!prog.p)return;const g=E.gl;g.useProgram(prog.p);
  g.uniform2f(prog.uRes,E.W,E.H);g.uniform2f(prog.uC,st.cx||E.W*0.5,(st.cy)||E.H*0.5);
  g.uniform1f(prog.uTime,t);g.uniform1f(prog.uSummon,st.summon);
  const pa=new Float32Array(NP),px=new Float32Array(NP);
  for(let k=0;k<st.pill.length;k++){pa[k]=st.pill[k].a;px[k]=st.pill[k].x;}
  g.uniform1fv(prog.uPillA,pa);g.uniform1fv(prog.uPillX,px);
  g.uniform1f(prog.uFloor,(st.floorY-st.cy)/Math.min(E.W,E.H));E.drawTri();},
 drawParticles(){E.drawPool(trail,E.ADD());E.drawPool(lance,E.ADD());E.drawPool(cross,E.ADD());E.drawPool(feath,E.ALPHA());},
 countParticles(){return lance.n+trail.n+cross.n+feath.n;}
});
})();
(function(){
"use strict";
const A=window.__ARC,E=A.env;
const shard=new E.Pool(480),disp=new E.Pool(1300),twinkle=new E.Pool(360);
const COL=[[1.0,.18,.28],[.22,1.0,.34],[.28,.34,1.0]];
const st={cx:0,cy:0,amt:0,phase:0,timer:0};
function geom(){st.cx=E.W*0.5;st.cy=E.H*0.5;}
function shardFn(p,i,dt){
 const dx=p.px[i]-st.cx,dy=p.py[i]-st.cy;const r=Math.hypot(dx,dy)||1;
 const tx=-dy/r,ty=dx/r,rx=dx/r,ry=dy/r;const s=p.seed[i];
 const ang=(560+160*s)*E.SC;                              /* tangential curl → spiral arc */
 const rad=(30+16*s)*E.SC*Math.max(0,1-r/(E.W*0.48));      /* outward push, eases near rim */
 p.vx[i]+=(tx*ang+rx*rad)*dt;p.vy[i]+=(ty*ang+ry*rad)*dt;
 p.vx[i]*=Math.exp(-0.55*dt);p.vy[i]*=Math.exp(-0.55*dt);
 p.rot[i]=Math.atan2(p.vy[i],p.vx[i]);
}
function dispFn(p,i,dt){p.vx[i]*=Math.exp(-1.8*dt);p.vy[i]*=Math.exp(-1.8*dt);}
function fire(){
 st.phase=2;st.timer=0;st.amt=1;
 E.flashAdd(.55,.78,.95,0.85);E.shakeAdd(10*E.SC);E.setCA(.016);
 for(let i=0;i<150;i++){const a=Math.random()*E.TAU,sp=E.rnd(30,130)*E.SC;
  shard.spawn(st.cx,st.cy,Math.cos(a)*sp,Math.sin(a)*sp,E.rnd(1.7,2.7),E.rnd(6,13)*E.SC,.9,.95,1.0,E.rnd(.62,.88),2,{rot:a,rv:0,seed:Math.random()});}
}
A.reg({
 id:'FX-157',name:'프리즘 나선 에너지파',en:'Prism Spiral Energy Wave',
 desc:'중심 충격이 곧장 날아가는 투사체가 아니라, 접선 방향 가속을 받아 휘말리는 나선 에너지파로 풀려나간다. 각 입자는 진행 수직으로 RGB 3색 분산 트레일을 분리 방출, 가산혼합 시 백색 코어·무지개 잔광 프린지(빛의 분산)를 그린다. 바깥으로 갈수록 회전력이 풀리며 자연스럽게 흩어지고 소멸 시 미세 분광 반짝임. 별도 배경판 없이 입자 잔광만으로 형상을 그린다.',
 tech:['Tangential-Accel Spiral Motion','Perpendicular RGB Dispersion Trails','Additive White Recombine','Edge-Easing Outward Drift','Spectral Twinkle on Expiry','No Background Plane'],
 bloom:0.88,
 init(){geom();},
 reset(){shard.clear();disp.clear();twinkle.clear();st.amt=0;st.phase=0;st.timer=0;geom();},
 resize(){geom();},
 autoPoint(){return [E.W*0.5,E.H*0.5];},
 trigger(x,y){if(st.phase!==0&&st.phase!==3)return;st.cx=E.clamp(x,E.W*0.25,E.W*0.75);st.cy=E.clamp(y,E.H*0.3,E.H*0.7);
  fire();},
 update(dt,t){
  st.timer+=dt;
  if(st.phase===2){st.amt=Math.max(0,1-st.timer/1.3);if(st.timer>1.3){st.phase=3;st.timer=0;}}
  else if(st.phase===3){if(shard.n===0&&st.timer>0.4){st.phase=0;st.timer=0;st.amt=0;}}
  /* dispersion trails: 3 chromatic offsets perpendicular to velocity */
  for(let i=0;i<shard.n;i++){const vx=shard.vx[i],vy=shard.vy[i];const sp=Math.hypot(vx,vy)||1;
   const nx=-vy/sp,ny=vx/sp;const off=(2.6+3.2*st.amt)*E.SC;
   for(let cIdx=0;cIdx<3;cIdx++){if(disp.n>=1280)break;const sgn=cIdx-1;const c=COL[cIdx];
    disp.spawn(shard.px[i]+nx*off*sgn,shard.py[i]+ny*off*sgn,0,0,E.rnd(.22,.4),E.rnd(4,8)*E.SC,c[0],c[1],c[2],0.56,0,{});}
   if(shard.life[i]<0.1&&twinkle.n<340&&Math.random()<0.3){const cIdx=(Math.random()*3)|0;const c=COL[cIdx];
    twinkle.spawn(shard.px[i],shard.py[i],0,0,E.rnd(.2,.5),E.rnd(2,5)*E.SC,c[0],c[1],c[2],0.7,0,{});}}
  shard.update(dt,t,shardFn);disp.update(dt,t,dispFn);twinkle.update(dt,t,dispFn);
 },
 drawField(){const g=E.gl;g.clearColor(0,0,0,1);g.clear(g.COLOR_BUFFER_BIT);},
 drawParticles(){E.drawPool(disp,E.ADD());E.drawPool(shard,E.ADD());E.drawPool(twinkle,E.ADD());},
 countParticles(){return shard.n+disp.n+twinkle.n;}
});
})();
(function(){
"use strict";
const A=window.__ARC,E=A.env;
const FS=[
'#version 300 es','precision highp float;','#define TAU 6.2831853',
'uniform vec2 uRes;uniform float uTime,uHead,uLen,uSpin,uFade,uAxis,uDecay;',
'out vec4 o;',E.NOISE,
'void main(){',
' vec2 uv=gl_FragCoord.xy/uRes;float asp=uRes.x/uRes.y;',
' vec3 col=vec3(0.0);',
' float headFull=uHead;float originF=-0.06;',
' float head=headFull;float origin=originF;',                /* full length stays put — only thickness converges */
' float along=uv.x;',
' float env=smoothstep(head,head-0.02,along)*smoothstep(origin-0.04,origin+0.02,along);',
' float q=clamp((head-along)/max(uLen,1e-3),0.,1.);',
' float dy=(uv.y-uAxis)*asp;',
' float wScale=mix(0.05,1.0,uDecay);',                       /* thick braid converges down to a thin line as it dies */
' float amp=0.13*smoothstep(0.0,0.22,q)*(1.0-0.25*q)*uDecay;', /* the 3 strands also collapse onto the centerline — they merge into ONE line, not stay spread thin */
' float beam=0.;vec3 bcol=vec3(0.);',
' float aura=exp(-pow(dy/(0.085*wScale),2.))*env*uDecay;',
' float tbA=fbm2(vec2(along*16.-uTime*2.2, dy*5.+uTime*0.6));',
' bcol+=mix(vec3(.35,.55,1.0),vec3(.85,.92,1.0),0.5+0.5*tbA)*aura*0.42;',
' float core=exp(-pow(dy/(0.016*wScale),2.))*env;',
' bcol+=vec3(1.0,1.0,1.0)*core*1.7;beam+=core;',
' for(int s=0;s<3;s++){float ph=along*58.0-uTime*uSpin+float(s)*2.0944;',
'  float depthF=0.5+0.5*cos(ph);',
'  float off=amp*sin(ph);',
'  float strand=exp(-pow((dy-off)/(0.020*wScale),2.))*env*(0.35+0.65*depthF);',
'  float off2=amp*sin(ph+3.14159);',
'  float strand2=exp(-pow((dy-off2)/(0.020*wScale),2.))*env*(0.35+0.65*(1.0-depthF));',
'  vec3 gold=mix(vec3(1.0,.52,.07),vec3(1.0,.9,.55),depthF);',
'  bcol+=gold*(strand*1.3+strand2*0.85);beam+=strand+strand2;',
' }',
' float tb=fbm2(vec2(along*34.-uTime*5., dy*8.+uTime));',
' bcol*=(0.65+0.55*tb);',
' float pulse=0.86+0.16*sin(uTime*9.0);',
' vec2 hp=vec2((along-head)*asp,dy);',
' float flareCore=exp(-dot(hp,hp)/(0.0032*wScale))*step(along,head+0.03)*uDecay;',
' float flareHalo=exp(-dot(hp,hp)/(0.018*wScale))*step(along,head+0.05)*uDecay;',
' bcol+=vec3(1.0,1.0,.97)*flareCore*2.5*pulse;',
' bcol+=vec3(1.0,.78,.42)*flareHalo*1.0*pulse;',
' col+=bcol*uFade*mix(0.4,1.0,uDecay);',
' col+=(h21(uv*uRes+uTime)-.5)*.010;',
' o=vec4(col,1.0);',
'}'
].join('\n');
const motes=new E.Pool(520),spark=new E.Pool(820),ember=new E.Pool(260),glint=new E.Pool(900);
let prog=null;const AXIS=0.5;
const st={phase:0,timer:0,head:-0.05,len:0.42,fade:0,decay:1,dur:2.0,decayDur:0.85};
function hx(){return st.head*E.W;}function hy(){return AXIS*E.H;}
function motesFn(p,i,dt){const c=E.curl2(p.px[i]*0.004,p.py[i]*0.004,0.2);p.vx[i]+=c[0]*110*E.SC*dt;p.vy[i]+=c[1]*90*E.SC*dt;p.vx[i]*=Math.exp(-1.1*dt);p.vy[i]*=Math.exp(-1.1*dt);}
function sparkFn(p,i,dt){p.vy[i]-=260*E.SC*dt;p.vx[i]*=Math.exp(-0.9*dt);p.vy[i]*=Math.exp(-0.9*dt);}
function emberFn(p,i,dt){p.vy[i]-=70*E.SC*dt;p.vx[i]*=Math.exp(-0.85*dt);p.vy[i]*=Math.exp(-0.85*dt);}
function glintFn(p,i,dt){p.vx[i]*=Math.exp(-2.4*dt);p.vy[i]*=Math.exp(-2.4*dt);}
A.reg({
 id:'FX-158',name:'나선 에너지 랜스',en:'Helical Energy Lance',
 desc:'배경 없는 암흑 속, 고정된 발원점에서 헤드까지 황금/백색 나선이 끊임없이 길어지며 뻗어나가는 에네르기파. 일정 길이 빛줄기가 통째로 미끄러져가는 투사체 느낌이 아니라, 뒤쪽은 발원점에 묶인 채 앞쪽만 계속 자라나 "쏘아져 길어지는" 느낌. 다 자란 뒤에는 무한정 이어지지 않고, 길이는 그대로 둔 채 두꺼운 나선이 점점 가늘어지며 3가닥이 중심선 하나로 수렴해 가느다란 한 줄의 빛이 되고, 그 가느다란 선마저 옅어지며 자연스레 소멸. 차가운 톤의 외곽 플라즈마 오라도 함께 좁아지고 옅어진다. 헤드는 일정한 박동으로 숨쉬듯 빛난다. 몸체 전체에서 잔불씨가 옅게 흘러나오고 헤드에서 스파크·글린트 비산.',
 tech:['No Background Plane','Fixed-Origin Lengthening Beam','Converge-to-Thin-Line Dissipation','Triple-Helix + Outer Plasma Aura','Breathing Head Pulse','Whole-Body Ember Bleed'],
 bloom:0.96,
 init(){prog=E.U(E.mkProg(E.FS_VERT,FS,'FX158'),['uRes','uTime','uHead','uLen','uSpin','uFade','uAxis','uDecay']);},
 reset(){motes.clear();spark.clear();ember.clear();glint.clear();st.phase=0;st.timer=0;st.head=-0.05;st.fade=0;st.decay=1;},
 resize(){},
 autoPoint(){return [E.W*0.5,AXIS*E.H];},
 trigger(x,y){if(st.phase!==0)return;st.phase=1;st.timer=0;st.head=-0.05;st.fade=0;st.decay=1;E.setCA(.006);E.shakeAdd(5*E.SC);},
 update(dt,t){
  if(st.phase===1){st.timer+=dt;
   const u=Math.min(1,st.timer/st.dur);
   st.head=-0.05+E.easeOutQuart(u)*1.18;
   st.fade=Math.min(1,st.fade+dt*4.);
   const px=hx(),py=hy(),sp=E.W*1.18/st.dur;
   if(st.head>-0.02&&st.head<1.08){
    for(let k=0;k<3;k++)motes.spawn(px+E.rnd(-20,10)*E.SC,py+E.rnd(-26,26)*E.SC,E.rnd(-30,15)*E.SC,E.rnd(-30,30)*E.SC,E.rnd(.5,1.1),E.rnd(16,34)*E.SC,.5,.62,.9,E.rnd(.16,.3),3,{seed:Math.random()});
    for(let k=0;k<5;k++){const a=E.rnd(-0.9,0.9);spark.spawn(px,py+E.rnd(-10,10)*E.SC,sp*0.28+Math.cos(a)*E.rnd(180,620)*E.SC,Math.sin(a)*E.rnd(180,620)*E.SC,E.rnd(.4,.85),E.rnd(2,6)*E.SC,1.0,E.rnd(.65,.9),.3,E.rnd(.7,.95),0,{seed:Math.random()});}
    for(let k=0;k<6;k++)glint.spawn(px-E.rnd(0,36)*E.SC,py+E.rnd(-18,18)*E.SC,sp*0.5+E.rnd(-50,50)*E.SC,E.rnd(-26,26)*E.SC,E.rnd(.15,.3),E.rnd(3,7)*E.SC,1.0,.85,.55,E.rnd(.4,.65),0,{});
    for(let k=0;k<4;k++){const along=E.rnd(-0.04,Math.max(0,st.head));const ex=along*E.W,ey=py+E.rnd(-7,7)*E.SC;
     ember.spawn(ex,ey,E.rnd(-30,30)*E.SC,E.rnd(-50,-12)*E.SC,E.rnd(.6,1.2),E.rnd(3,7)*E.SC,1.0,.7,.32,E.rnd(.35,.6),0,{});}
   }
   if(st.timer>st.dur){st.phase=2;st.timer=0;st.decay=1;}}
  else if(st.phase===2){st.timer+=dt;
   st.decay=Math.max(0,1-st.timer/st.decayDur);
   /* a thin trickle of embers as the wave retracts — visibly dying down, not silently vanishing */
   if(st.decay>0.04&&Math.random()<0.45){const along=E.rnd(-0.06,Math.max(0,st.head));
    ember.spawn(along*E.W,hy()+E.rnd(-6,6)*E.SC,E.rnd(-20,20)*E.SC,E.rnd(-40,-10)*E.SC,E.rnd(.4,.8),E.rnd(2,5)*E.SC,1.0,.65,.3,st.decay*E.rnd(.3,.5),0,{});}
   if(st.decay<=0){st.phase=0;st.timer=0;}}
  motes.update(dt,t,motesFn);spark.update(dt,t,sparkFn);ember.update(dt,t,emberFn);glint.update(dt,t,glintFn);
 },
 drawField(t){if(!prog||!prog.p)return;const g=E.gl;g.useProgram(prog.p);
  g.uniform2f(prog.uRes,E.W,E.H);g.uniform1f(prog.uTime,t);
  g.uniform1f(prog.uHead,st.head);g.uniform1f(prog.uLen,st.len);g.uniform1f(prog.uSpin,34.);
  g.uniform1f(prog.uFade,st.fade);g.uniform1f(prog.uAxis,AXIS);g.uniform1f(prog.uDecay,st.decay);E.drawTri();},
 drawParticles(){E.drawPool(motes,E.ALPHA());E.drawPool(glint,E.ADD());E.drawPool(spark,E.ADD());E.drawPool(ember,E.ADD());},
 countParticles(){return motes.n+spark.n+ember.n+glint.n;}
});
})();
(function(){
"use strict";
const A=window.__ARC,E=A.env;
const FS=[
'#version 300 es','precision highp float;','#define TAU 6.2831853',
'uniform vec2 uRes;uniform float uTime,uHeadX,uCoreY,uPow;',
'out vec4 o;',E.NOISE,
'void main(){',
' vec2 uv=gl_FragCoord.xy/uRes;float asp=uRes.x/uRes.y;',
' vec3 col=mix(vec3(.012,.006,.024),vec3(.002,.001,.008),clamp(length(uv-0.5)*1.2,0.,1.));',
' vec2 p=(uv-vec2(uHeadX,uCoreY))*vec2(asp,1.0);',
' float r=length(p);float ang=atan(p.y,p.x);',
' float swirl=uTime*2.2+1.1/(r+0.05);',                                   /* gravitational drag */
/* lensed background nebula sampled with swirled coords */
' vec2 sp=vec2(cos(ang+swirl),sin(ang+swirl))*r;',
' float bg=fbm2(sp*4.0+vec2(uTime*.1,0.));',
' col+=vec3(.35,.18,.6)*bg*bg*exp(-r*2.2)*uPow*1.4;',
/* accretion ring + spiral arms */
' float ring=exp(-pow((r-0.055)*42.,2.));',
' col+=vec3(.8,.55,1.0)*ring*uPow*2.0;',
' float arms=pow(0.5+0.5*sin(ang*2.0+swirl),3.0)*exp(-r*5.0);',
' col+=vec3(.6,.4,1.0)*arms*uPow*1.6;',
' col+=vec3(1.0,.95,1.0)*exp(-r*r*900.)*uPow*2.2;',                       /* hot inner edge */
/* dark event-horizon core */
' col*=1.-(1.-smoothstep(0.0,0.042,r))*uPow;',
' col*=1.-0.3*length(uv-0.5);',
' col+=(h21(uv*uRes+uTime)-.5)*.009;',
' o=vec4(col,1.0);',
'}'
].join('\n');
const spiral=new E.Pool(1100),debris=new E.Pool(520),flash=new E.Pool(220);
let prog=null;const CY=0.5;
const st={phase:0,timer:0,head:-0.05,pow:0,dur:1.7};
function hx(){return st.head*E.W;}function hy(){return CY*E.H;}
function spiralFn(p,i,dt){ /* swirl into the core */
 const cx=hx(),cy=hy();const dx=p.px[i]-cx,dy=p.py[i]-cy;const r=Math.hypot(dx,dy)||1;
 const tang=Math.atan2(dy,dx)+Math.PI*0.5;
 const sw=Math.min(1, (Math.min(E.W,E.H)*0.16)/r)*420*E.SC;
 p.vx[i]+=(Math.cos(tang)*sw - dx*1.6)*dt;
 p.vy[i]+=(Math.sin(tang)*sw - dy*1.6)*dt;
 p.vx[i]*=Math.exp(-0.7*dt);p.vy[i]*=Math.exp(-0.7*dt);
}
A.reg({
 id:'FX-161',name:'특이점탄',en:'Singularity Bolt',
 desc:'중력 특이점을 품은 암흑 코어 투사체가 전진하며 배경 성운을 휘감아 굴절(렌즈)시킨다. 강착 원반 링·나선 팔이 1/r 드래그로 끌려 돌고, 사건지평선 흑심이 빛을 삼킨다. 주변 입자가 접선 가속+중심 인력으로 나선 강착하며 빨려드는 보랏빛 항적. 동심원 단순 폭발이 아닌 시공 왜곡 표현.',
 tech:['Moving Dark Core','1/r Gravitational Swirl','Lensed Nebula BG','Accretion Ring + Spiral Arms','Event-Horizon Cutout','Tangential Inspiral Particles'],
 bloom:0.9,
 init(){prog=E.U(E.mkProg(E.FS_VERT,FS,'FX161'),['uRes','uTime','uHeadX','uCoreY','uPow']);},
 reset(){spiral.clear();debris.clear();flash.clear();st.phase=0;st.timer=0;st.head=-0.05;st.pow=0;},
 resize(){},
 autoPoint(){return [E.W*0.5,CY*E.H];},
 trigger(x,y){if(st.phase!==0)return;st.phase=1;st.timer=0;st.head=-0.05;st.pow=0;E.setCA(.014);E.shakeAdd(8*E.SC);},
 update(dt,t){
  if(st.phase===1){st.timer+=dt;const u=Math.min(1,st.timer/st.dur);
   st.head=-0.05+u*1.12;st.pow=Math.min(1,st.pow+dt*3.);
   if(st.timer>st.dur*0.85)st.pow=Math.max(0,st.pow-dt*3.);
   const cx=hx(),cy=hy();
   /* feed inspiral particles around core */
   for(let k=0;k<8;k++){const a=Math.random()*E.TAU,rr=E.rnd(0.1,0.32)*Math.min(E.W,E.H);
    spiral.spawn(cx+Math.cos(a)*rr,cy+Math.sin(a)*rr,0,0,E.rnd(.5,1.1),E.rnd(2,5)*E.SC,.7,.5,1.0,E.rnd(.4,.7),0,{seed:Math.random()});}
   for(let k=0;k<2;k++){const a=Math.random()*E.TAU;debris.spawn(cx+Math.cos(a)*8*E.SC,cy+Math.sin(a)*8*E.SC,Math.cos(a)*E.rnd(40,160)*E.SC,Math.sin(a)*E.rnd(40,160)*E.SC,E.rnd(.4,.8),E.rnd(2,5)*E.SC,.85,.7,1.0,E.rnd(.5,.8),2,{rot:a,rv:E.rnd(-6,6)});}
   if(st.timer>st.dur+0.2){st.phase=2;st.timer=0;}}
  else if(st.phase===2){st.pow=Math.max(0,st.pow-dt*2.);if(spiral.n===0&&debris.n===0){st.phase=0;}}
  spiral.update(dt,t,spiralFn);debris.update(dt,t,spiralFn);flash.update(dt,t,null);
 },
 drawField(t){if(!prog||!prog.p)return;const g=E.gl;g.useProgram(prog.p);
  g.uniform2f(prog.uRes,E.W,E.H);g.uniform1f(prog.uTime,t);
  g.uniform1f(prog.uHeadX,st.head);g.uniform1f(prog.uCoreY,CY);g.uniform1f(prog.uPow,st.pow);E.drawTri();},
 drawParticles(){E.drawPool(spiral,E.ADD());E.drawPool(debris,E.ADD());E.drawPool(flash,E.ADD());},
 countParticles(){return spiral.n+debris.n+flash.n;}
});
})();
(function(){
"use strict";
const A=window.__ARC,E=A.env;
const FS=[
'#version 300 es',
'precision highp float;',
'uniform vec2 uRes;uniform float uTime,uLock,uDom;',
'uniform float uCD[7];',
'uniform float uCV[7];',
'out vec4 o;',
E.NOISE,
'void main(){',
' float mn=min(uRes.x,uRes.y);',
' vec2 sq=(gl_FragCoord.xy-uRes*.5)/mn;',
' vec3 col=mix(vec3(.03,.006,.012),vec3(.008,.002,.005),clamp(sq.y+.55,0.,1.));',
' float nb=fbm2(sq*2.2+vec2(uTime*.02,0.));',
' col+=vec3(.10,.012,.03)*nb*nb;',
' float gy=-.36;',
' col+=vec3(.08,.01,.02)*exp(-pow((sq.y-gy)*10.,2.));',
' col*=1.-uDom*.4*clamp(dot(sq,sq)*1.6,0.,1.);',
' for(int i=0;i<7;i++){',
'  float drop=uCD[i];',
'  if(drop>0.001){',
'   float fi=float(i);',
'   float cx=(fi-3.)*.205+.04*sin(fi*2.7);',
'   float tilt=.10*sin(fi*1.9+.7);',
'   float yHead=mix(.62,gy,drop);',
'   float y=sq.y;',
'   float mask=smoothstep(yHead-.012,yHead+.012,y)*(1.-smoothstep(.56,.62,y));',
'   if(mask>0.002){',
'    float lat=cx+tilt*(.62-y);',
'    lat+=uCV[i]*sin(y*34.+uTime*52.+fi*5.);',
'    float dx=sq.x-lat;',
'    float s=(.62-y)*16.;',
'    float lp=.5+.5*abs(sin(s*3.14159));',
'    float w=.0135*(.68+.55*lp);',
'    float core=exp(-dx*dx/(w*w));',
'    float halo=exp(-dx*dx/(w*w*18.))*.32;',
'    vec3 cc=vec3(.88,.06,.08)*(.55+.45*lp)+vec3(.3,.015,.025);',
'    float pulse=1.+1.4*uLock*(.7+.45*sin(uTime*6.+fi*1.8+y*4.));',
'    col+=(cc*core*pulse+vec3(1.,.28,.24)*halo)*mask;',
'    float hot=exp(-pow((y-yHead)*9.,2.))*(1.-smoothstep(.985,1.,drop));',
'    col+=vec3(1.5,.85,.7)*hot*core*2.2;',
'   }',
'   float lockI=smoothstep(.96,1.,drop);',
'   if(lockI>0.001){',
'    vec2 ap=vec2(sq.x-(cx+tilt*(.62-gy)),(sq.y-gy)*2.3);',
'    float ad=length(ap);',
'    col+=vec3(1.2,.14,.11)*exp(-ad*15.)*lockI*(.4+.6*uLock);',
'    col+=vec3(1.,.22,.18)*exp(-pow((ad-.085)*44.,2.))*lockI*uLock*.85;',
'    float cr=abs(fbm2(ap*9.+fi)*2.-1.);',
'    float vein=(1.-smoothstep(0.,.16,cr))*(1.-smoothstep(.05,.2,ad));',
'    col+=vec3(.9,.1,.1)*vein*lockI*uLock*.8;',
'   }',
'  }',
' }',
' o=vec4(col,1.);',
'}'
].join('\n');
const spark=new E.Pool(1024);
const smoke=new E.Pool(320);
let prog=null;
const st={phase:0,timer:0,lock:0,dom:0,acc:0};
const cd=new Float32Array(7),cv=new Float32Array(7),lockT=new Float32Array(7);
function anchorPx(i){
 const mn=Math.min(E.W,E.H);
 const cx=(i-3)*0.205+0.04*Math.sin(i*2.7);
 const tilt=0.10*Math.sin(i*1.9+0.7);
 const gy=-0.36;
 return [E.W*0.5+(cx+tilt*(0.62-gy))*mn,E.H*0.5+gy*mn];
}
function slam(i){
 const s=anchorPx(i);
 E.shakeAdd(9*E.SC);E.flashAdd(0.22,1,.3,.3);
 for(let k=0;k<22;k++){
  spark.spawn(s[0]+E.rnd(-14,14)*E.SC,s[1]+E.rnd(0,8)*E.SC,
   E.rnd(-380,380)*E.SC,E.rnd(140,640)*E.SC,
   E.rnd(.35,.8),E.rnd(2.5,7)*E.SC,1.25,.22,.2,E.rnd(.6,.95),0,
   {drag:.8,grav:-1600*E.SC});
 }
 for(let k=0;k<3;k++){
  smoke.spawn(s[0],s[1],E.rnd(-80,80)*E.SC,E.rnd(25,110)*E.SC,
   E.rnd(1,1.8),E.rnd(40,95)*E.SC,.1,.04,.05,E.rnd(.25,.4),3,
   {drag:.9,rot:Math.random()*E.TAU,rv:E.rnd(-.5,.5)});
 }
}
A.reg({
 id:'NX-01',name:'진홍 사슬 결계',en:'Crimson Chain Domain',
 desc:'혈홍 에너지 사슬 7조가 0.13초 선형 낙하로 공간을 봉쇄 — 착지 순간 고주파 진동이 지수 감쇠(수학적 장력)하고, 정착점마다 균열 인장이 맥동. 결계 비네트가 화면을 짓누른다.',
 tech:['7-Chain Uniform Array','Damped Sine Tension','Link SDF Repetition','Anchor Crack Sigils','Domain Vignette Grade'],
 bloom:1.0,
 init(){
  prog=E.U(E.mkProg(E.FS_VERT,FS,'NX01'),['uRes','uTime','uLock','uDom','uCD','uCV']);
 },
 reset(){
  spark.clear();smoke.clear();
  st.phase=0;st.timer=0;st.lock=0;st.dom=0;st.acc=0;
  cd.fill(0);cv.fill(0);lockT.fill(-1);
 },
 autoPoint(){return [E.W*0.5,E.H*0.5];},
 trigger(){
  if(st.phase!==0)return;
  st.phase=1;st.timer=0;lockT.fill(-1);
 },
 update(dt,t){
  st.timer+=dt;
  if(st.phase===0){
   st.lock=Math.max(0,st.lock-dt*2);
   st.dom=Math.max(0,st.dom-dt*1.5);
   for(let i=0;i<7;i++)cd[i]=Math.max(0,cd[i]-dt*2.5);
  }else if(st.phase===1){
   st.dom=Math.min(1,st.timer/0.5);
   let all=true;
   for(let i=0;i<7;i++){
    const u=E.clamp((st.timer-i*0.05)/0.13,0,1);
    cd[i]=u;
    if(u>=1&&lockT[i]<0){lockT[i]=t;slam(i);}
    if(u<1)all=false;
    cv[i]=lockT[i]>=0?0.05*Math.exp(-6*(t-lockT[i])):0;
    if(cv[i]<0.0008)cv[i]=0;
   }
   st.lock=Math.min(1,Math.max(0,(st.timer-0.4)/0.4));
   if(all&&st.timer>3.6){st.phase=2;st.timer=0;}
  }else{
   const u=Math.min(1,st.timer/0.55);
   st.lock=1-u;
   st.dom=1-u;
   for(let i=0;i<7;i++)cd[i]=1-E.easeOutCubic(u);
   if(u>=0.4&&st.acc<1){
    st.acc=1;
    for(let k=0;k<120;k++){
     spark.spawn(E.rnd(0,E.W),E.rnd(E.H*0.1,E.H*0.6),
      E.rnd(-60,60),E.rnd(300,900)*E.SC,
      E.rnd(.4,.9),E.rnd(2,6)*E.SC,1.1,.18,.2,E.rnd(.5,.9),0,{drag:.6});
    }
   }
   if(u>=1){st.phase=0;st.timer=0;st.acc=0;cd.fill(0);}
  }
  spark.update(dt,t,null);
  smoke.update(dt,t,null);
 },
 drawField(t){
  if(!prog||!prog.p)return;
  const g=E.gl;
  g.useProgram(prog.p);
  g.uniform2f(prog.uRes,E.W,E.H);
  g.uniform1f(prog.uTime,t);
  g.uniform1f(prog.uLock,st.lock);
  g.uniform1f(prog.uDom,st.dom);
  g.uniform1fv(prog.uCD,cd);
  g.uniform1fv(prog.uCV,cv);
  E.drawTri();
 },
 drawParticles(){
  E.drawPool(spark,E.ADD());
  E.drawPool(smoke,E.ALPHA());
 },
 countParticles(){return spark.n+smoke.n;}
});
})();
(function(){
"use strict";
const A=window.__ARC,E=A.env;
const FS=[
'#version 300 es',
'precision highp float;',
'uniform vec2 uRes,uC;uniform float uTime,uBloom,uLotA,uFrost;',
'out vec4 o;',
E.NOISE,
'void main(){',
' float mn=min(uRes.x,uRes.y);',
' vec2 uv=(gl_FragCoord.xy-uC)/mn;',
' float d=length(uv);',
' float ang=atan(uv.y,uv.x);',
' vec3 col=mix(vec3(.012,.022,.042),vec3(.003,.006,.015),clamp(uv.y+.5,0.,1.));',
' col+=vec3(.16,.22,.28)*exp(-length(uv-vec2(.32,.4))*3.2)*.5;',
' float sn=n2(uv*26.+vec2(uTime*.12,-uTime*.5));',
' col+=vec3(.5,.6,.7)*smoothstep(.96,1.,sn)*.35;',
' float nb=fbm2(uv*2.+vec2(0.,uTime*.015));',
' col+=vec3(.02,.04,.07)*nb*nb;',
' if(uLotA>0.001&&uBloom>0.02){',
'  float rot=uTime*.22;',
'  float tex=.55+.55*fbm2(uv*9.+vec2(rot,0.));',
'  float vein=1.-smoothstep(0.,.05,abs(fbm2(uv*6.5+vec2(3.1,1.7))-.5));',
'  float p1=.22+.78*pow(abs(cos((ang+rot)*4.)),.55);',
'  float p2=.22+.78*pow(abs(cos((ang-rot*1.3+.39)*4.)),.55);',
'  float r1=uBloom*.40*p1;',
'  float r2=uBloom*.255*p2;',
'  float f1=1.-smoothstep(r1*.5,max(r1,1e-3),d);',
'  float f2=1.-smoothstep(r2*.45,max(r2,1e-3),d);',
'  float rim1=exp(-pow((d-r1)*46.,2.));',
'  float rim2=exp(-pow((d-r2)*60.,2.));',
'  vec3 lc=vec3(.10,.30,.42)*f1*tex;',
'  lc+=vec3(.22,.5,.62)*f2*tex;',
'  lc+=vec3(.45,.85,1.)*vein*(f1+f2)*.55;',
'  lc+=vec3(.7,1.05,1.2)*rim1*.9;',
'  lc+=vec3(.95,1.25,1.4)*rim2*.8;',
'  lc+=vec3(1.1,1.35,1.5)*exp(-d*26./max(uBloom,.2))*.6;',
'  col+=lc*uLotA;',
' }',
' if(uFrost>0.001){',
'  vec2 fv=vec2(uv.x,(uv.y+.16)*2.1);',
'  float fd=length(fv);',
'  float mask=1.-smoothstep(uFrost*.55,max(uFrost,1e-3),fd);',
'  float cr=abs(fbm2(fv*8.)*2.-1.);',
'  float vein2=1.-smoothstep(0.,.18,cr);',
'  float tw=.6+.6*n2(fv*30.+vec2(uTime*1.5,0.));',
'  col+=(vec3(.08,.26,.38)*.5+vec3(.4,.85,1.05)*vein2*tw)*mask;',
'  col+=vec3(.5,.95,1.15)*exp(-pow((fd-uFrost)*26.,2.))*.7;',
' }',
' o=vec4(col,1.);',
'}'
].join('\n');
const shard=new E.Pool(640);
const glit=new E.Pool(768);
const mist=new E.Pool(192);
let prog=null;
const st={phase:0,timer:0,cx:0,cy:0,bloom:0,lotA:1,frost:0,floorY:0};
const easeIO=t=>t<0.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2;
function shardFn(p,i,dt){
 if(p.py[i]<st.floorY&&p.vy[i]<0){
  p.py[i]=st.floorY;
  p.vy[i]*=-0.42;
  p.vx[i]*=0.78;
  p.rv[i]*=0.6;
  if(Math.abs(p.vy[i])<60*E.SC){p.vy[i]=0;p.grav[i]=0;p.vx[i]*=0.9;}
 }
}
function shatter(){
 st.phase=3;st.timer=0;st.lotA=0;
 E.flashAdd(1,.75,1,1.2);E.shakeAdd(20*E.SC);E.setCA(0.011);
 const mn=Math.min(E.W,E.H);
 st.floorY=Math.max(E.H*0.06,st.cy-0.34*mn);
 for(let i=0;i<240;i++){
  const a=Math.random()*E.TAU;
  const sp=E.rnd(260,1250)*E.SC;
  const m=Math.random();
  shard.spawn(st.cx,st.cy,Math.cos(a)*sp,Math.sin(a)*sp,
   E.rnd(2,3.4),E.rnd(8,26)*E.SC,
   .55+m*.35,.85+m*.3,1.05+m*.25,E.rnd(.7,.95),2,
   {rot:Math.random()*E.TAU,rv:E.rnd(-6,6),drag:.5,grav:-2300*E.SC});
 }
 for(let i=0;i<160;i++){
  const a=Math.random()*E.TAU;
  const sp=E.rnd(400,1500)*E.SC;
  glit.spawn(st.cx,st.cy,Math.cos(a)*sp,Math.sin(a)*sp,
   E.rnd(.3,.7),E.rnd(2,6)*E.SC,.9,1.2,1.4,.95,0,{drag:2.2});
 }
 for(let i=0;i<40;i++){
  mist.spawn(st.cx+E.rnd(-40,40)*E.SC,st.cy+E.rnd(-40,40)*E.SC,
   E.rnd(-120,120)*E.SC,E.rnd(-40,90)*E.SC,
   E.rnd(1.5,2.8),E.rnd(55,130)*E.SC,.5,.7,.82,E.rnd(.12,.25),3,
   {drag:.7,rot:Math.random()*E.TAU,rv:E.rnd(-.4,.4)});
 }
}
A.reg({
 id:'NX-05',name:'빙백 연화 파쇄',en:'Glacial Lotus Shatter',
 desc:'서리 기운이 8판 첨예 연화로 ease-in-out 개화(결정맥 필라멘트 투명 화판) → 1프레임 파쇄. 빙편 240매가 중력 낙하 후 바닥 탄성 바운스로 잦아들고, 한기 서리가 지면을 덮는다.',
 tech:['Pointed Polar Lotus x2','Crystal Vein Petals','1-Frame Shatter','Floor Bounce Physics','Glitter + Frost Spread'],
 bloom:0.95,
 init(){
  prog=E.U(E.mkProg(E.FS_VERT,FS,'NX05'),['uRes','uC','uTime','uBloom','uLotA','uFrost']);
 },
 reset(){
  shard.clear();glit.clear();mist.clear();
  st.phase=0;st.timer=0;st.bloom=0;st.lotA=1;st.frost=0;
  st.cx=E.W*0.5;st.cy=E.H*0.55;
 },
 autoPoint(){return [E.W*0.5,E.H*0.55];},
 trigger(x,y){
  if(st.phase!==0)return;
  st.phase=1;st.timer=0;st.lotA=1;
  st.cx=x;st.cy=E.clamp(y,E.H*0.4,E.H*0.75);
 },
 update(dt,t){
  st.timer+=dt;
  if(st.phase===0){
   st.bloom=0.1+0.02*Math.sin(t*1.5);
   st.frost=Math.max(0,st.frost-dt*0.5);
  }else if(st.phase===1){
   const u=Math.min(1,st.timer/1.2);
   st.bloom=E.lerp(0.12,1,easeIO(u));
   if(u>=1){st.phase=2;st.timer=0;}
  }else if(st.phase===2){
   st.bloom=1+0.015*Math.sin(t*24);
   if(st.timer>0.4)shatter();
  }else{
   st.frost=Math.min(0.65,st.frost+dt*0.5);
   if(st.timer>3.6){st.phase=0;st.timer=0;st.bloom=0.1;st.lotA=1;}
  }
  shard.update(dt,t,st.phase===3?shardFn:null);
  glit.update(dt,t,null);
  mist.update(dt,t,null);
 },
 drawField(t){
  if(!prog||!prog.p)return;
  const g=E.gl;
  g.useProgram(prog.p);
  g.uniform2f(prog.uRes,E.W,E.H);
  g.uniform2f(prog.uC,st.cx||E.W*0.5,st.cy||E.H*0.55);
  g.uniform1f(prog.uTime,t);
  g.uniform1f(prog.uBloom,st.bloom);
  g.uniform1f(prog.uLotA,st.lotA);
  g.uniform1f(prog.uFrost,st.frost);
  E.drawTri();
 },
 drawParticles(){
  E.drawPool(shard,E.ADD());
  E.drawPool(glit,E.ADD());
  E.drawPool(mist,E.ALPHA());
 },
 countParticles(){return shard.n+glit.n+mist.n;}
});
})();
(function(){
"use strict";
const A=window.__ARC,E=A.env;
const FS=[
'#version 300 es',
'precision highp float;',
'uniform vec2 uRes,uHit;uniform float uTime,uScorch,uCol,uRing,uA1,uA2;',
'out vec4 o;',
E.NOISE,
'void main(){',
' float mn=min(uRes.x,uRes.y);',
' vec2 sq=(gl_FragCoord.xy-uRes*.5)/mn;',
' vec3 col=mix(vec3(.018,.022,.04),vec3(.006,.007,.015),clamp(sq.y+.5,0.,1.));',
' float cl=fbm2(sq*2.4+vec2(uTime*.05,uTime*.012));',
' col+=vec3(.05,.06,.1)*cl*cl;',
' float sheet=smoothstep(.88,1.,n2(vec2(floor(uTime*7.),3.7)));',
' col+=vec3(.12,.12,.22)*cl*sheet*.6;',
' vec2 hv=(gl_FragCoord.xy-uHit)/mn;',
' if(uScorch>0.001){',
'  float heat=uScorch;',
'  float mark=smoothstep(0.,.12,uScorch);',
'  float ch=0.;',
'  for(int k=0;k<2;k++){',
'   float aK=(k==0)?uA1:uA2;',
'   float ca=cos(aK),sa=sin(aK);',
'   vec2 q=mat2(ca,-sa,sa,ca)*vec2(hv.x,hv.y*2.0);',
'   ch+=exp(-pow(q.y*16.,2.))*(1.-smoothstep(.04,.4,abs(q.x)));',
'  }',
'  ch=clamp(ch,0.,1.);',
'  col=mix(col,col*.2,ch*mark*.9);',
'  float vn=smoothstep(.55,.72,fbm2(hv*15.+vec2(1.3,7.7)));',
'  col+=vec3(1.3,.5,.14)*ch*vn*heat*heat*1.4;',
'  col+=vec3(.55,.4,1.)*ch*vn*heat*.3;',
' }',
' if(uCol>0.001){',
'  float pil=exp(-hv.x*hv.x*46.)*clamp(hv.y*2.+1.,0.,1.);',
'  col+=vec3(.7,.65,1.35)*pil*uCol*1.4;',
'  col+=vec3(.95,.95,1.4)*exp(-dot(hv,hv)*8.)*uCol*1.2;',
' }',
' if(uRing>0.001){',
'  vec2 rv=hv;rv.y*=2.1;',
'  float dd=length(rv);',
'  float rr=uRing*.9;',
'  col+=vec3(.7,.7,1.3)*exp(-pow((dd-rr)*16.,2.))*(1.-uRing)*1.8;',
' }',
' o=vec4(col,1.);',
'}'
].join('\n');
const BOLT_VS=[
'#version 300 es',
'layout(location=0) in vec2 aPos;',
'layout(location=1) in vec2 aUV;',
'layout(location=2) in float aFade;',
'uniform vec2 uRes;',
'out vec2 vUV;out float vB;',
'void main(){',
' vec2 n=aPos/uRes*2.-1.;',
' gl_Position=vec4(n,0.,1.);',
' vUV=aUV;vB=aFade;',
'}'
].join('\n');
const BOLT_FS=[
'#version 300 es',
'precision highp float;',
'in vec2 vUV;in float vB;',
'out vec4 o;',
'void main(){',
' float v=vUV.y*2.-1.;',
' float core=exp(-v*v*16.);',
' float halo=exp(-v*v*2.2)*.4;',
' vec3 c=vec3(1.4,1.35,1.65)*core+vec3(.5,.32,1.25)*halo;',
' o=vec4(c,(core+halo)*vB);',
'}'
].join('\n');
const SLOTS=10,NSEG=22,FPV=5;
const verts=new Float32Array(SLOTS*NSEG*2*FPV);
const bolts=[];
for(let s=0;s<SLOTS;s++){
 bolts.push({active:false,t0:0,w:0,
  bx:new Float32Array(NSEG),by:new Float32Array(NSEG),
  nx:new Float32Array(NSEG),ny:new Float32Array(NSEG)});
}
const spark=new E.Pool(1024);
const smoke=new E.Pool(256);
let prog=null,bprog=null,vbo=null,vao=null;
const st={timer:0,scorch:0,colF:0,ring:0,a1:0,a2:0,acc:0};
function genPath(slot,x0,y0,x1,y1,jit,w){
 slot.active=true;slot.t0=st.timer;slot.w=w;
 for(let i=0;i<NSEG;i++){
  const u=i/(NSEG-1);
  const dx=x1-x0,dy=y1-y0;
  const L=Math.hypot(dx,dy)||1;
  const px=-dy/L,py=dx/L;
  const env=Math.sin(Math.PI*u);
  const j=(E.vnoise(u*6+slot.t0*7,slot.t0*3)-0.5)*2*jit*env
   +(E.vnoise(u*19+slot.t0*11,5.5)-0.5)*jit*0.5*env;
  slot.bx[i]=x0+dx*u+px*j;
  slot.by[i]=y0+dy*u+py*j;
 }
 for(let i=0;i<NSEG;i++){
  const a=Math.max(0,i-1),b=Math.min(NSEG-1,i+1);
  let tx=slot.bx[b]-slot.bx[a],ty=slot.by[b]-slot.by[a];
  const tl=Math.hypot(tx,ty)||1;
  slot.nx[i]=-ty/tl;slot.ny[i]=tx/tl;
 }
}
function freeSlot(){for(const b of bolts)if(!b.active)return b;return null;}
A.reg({
 id:'NX-07',name:'십자 뇌정 강타',en:'Cross-Lightning Smite',
 desc:'거대 뇌정 2주가 교차 강하 — 0프레임 출현, 2프레임 내 최대 휘도, 소산기엔 프레임 단위 무작위 알파 플리커. 지면엔 십자 탄흔이 새겨져 잔열 정맥이 식어간다.',
 tech:['Midpoint-displaced Bolts','2-Frame Peak Ramp','Per-frame Alpha Flicker','Cross Scorch Decals','Cooling Ember Veins'],
 bloom:1.1,
 init(){
  const g=E.gl;
  prog=E.U(E.mkProg(E.FS_VERT,FS,'NX07'),['uRes','uHit','uTime','uScorch','uCol','uRing','uA1','uA2']);
  bprog=E.U(E.mkProg(BOLT_VS,BOLT_FS,'NX07b'),['uRes']);
  vbo=g.createBuffer();
  g.bindBuffer(g.ARRAY_BUFFER,vbo);
  g.bufferData(g.ARRAY_BUFFER,verts.byteLength,g.DYNAMIC_DRAW);
  vao=g.createVertexArray();
  g.bindVertexArray(vao);
  g.bindBuffer(g.ARRAY_BUFFER,vbo);
  g.enableVertexAttribArray(0);
  g.vertexAttribPointer(0,2,g.FLOAT,false,FPV*4,0);
  g.enableVertexAttribArray(1);
  g.vertexAttribPointer(1,2,g.FLOAT,false,FPV*4,8);
  g.enableVertexAttribArray(2);
  g.vertexAttribPointer(2,1,g.FLOAT,false,FPV*4,16);
  g.bindVertexArray(null);
 },
 reset(){
  spark.clear();smoke.clear();
  for(const b of bolts)b.active=false;
  st.timer=0;st.scorch=0;st.colF=0;st.ring=0;st.acc=0;
  st.hx=E.W*0.5;st.hy=E.H*0.3;
 },
 autoPoint(){return [E.W*0.5,E.H*0.32];},
 trigger(x,y){
  const mn=Math.min(E.W,E.H);
  st.hx=x;st.hy=E.clamp(y,E.H*0.12,E.H*0.5);
  const s1x=x-E.W*0.34+E.rnd(-40,40),s2x=x+E.W*0.34+E.rnd(-40,40);
  const top=E.H+40*E.SC;
  const b1=freeSlot();if(b1)genPath(b1,s1x,top,st.hx,st.hy,0.10*mn,13*E.SC);
  const b2=freeSlot();if(b2)genPath(b2,s2x,top,st.hx,st.hy,0.10*mn,13*E.SC);
  st.a1=Math.atan2(st.hy-top,st.hx-s1x);
  st.a2=Math.atan2(st.hy-top,st.hx-s2x);
  for(const main of [b1,b2]){
   if(!main)continue;
   for(let k=0;k<2;k++){
    const br=freeSlot();if(!br)break;
    const ni=4+Math.floor(Math.random()*(NSEG-10));
    const bx=main.bx[ni],by=main.by[ni];
    const a=Math.atan2(st.hy-by,st.hx-bx)+E.rnd(-1.1,1.1);
    const L=mn*E.rnd(.12,.22);
    genPath(br,bx,by,bx+Math.cos(a)*L,by+Math.sin(a)*L,0.04*mn,6*E.SC);
   }
  }
  st.colF=1;st.ring=0.001;st.scorch=1;
  E.flashAdd(1,.85,.85,1.2);E.shakeAdd(24*E.SC);E.setCA(0.013);
  for(let i=0;i<150;i++){
   const a=Math.PI*0.5+E.rnd(-1.4,1.4);
   const sp=E.rnd(300,1300)*E.SC;
   spark.spawn(st.hx,st.hy,Math.cos(a)*sp,Math.sin(a)*sp,
    E.rnd(.3,.8),E.rnd(2,7)*E.SC,.9,.85,1.5,.95,0,
    {drag:1.2,grav:-1300*E.SC});
  }
  for(let i=0;i<30;i++){
   smoke.spawn(st.hx+E.rnd(-50,50)*E.SC,st.hy,
    E.rnd(-70,70)*E.SC,E.rnd(40,150)*E.SC,
    E.rnd(1.2,2.4),E.rnd(45,110)*E.SC,.09,.08,.12,E.rnd(.25,.4),3,
    {drag:.8,rot:Math.random()*E.TAU,rv:E.rnd(-.5,.5)});
  }
 },
 update(dt,t){
  st.timer+=dt;
  st.colF=Math.max(0,st.colF-dt*3.2);
  st.ring=st.ring>0?Math.min(1,st.ring+dt*1.6):0;
  if(st.ring>=1)st.ring=0;
  st.scorch=Math.max(0,st.scorch-dt*0.22);
  for(const b of bolts){
   if(b.active&&st.timer-b.t0>0.85)b.active=false;
  }
  if(st.scorch>0.25){
   st.acc+=dt*9;
   while(st.acc>1){
    st.acc--;
    const k=Math.random()<0.5?st.a1:st.a2;
    const r=E.rnd(20,120)*E.SC;
    spark.spawn(st.hx+Math.cos(k)*r*E.rnd(-1,1),st.hy+E.rnd(-8,8)*E.SC,
     E.rnd(-20,20),E.rnd(50,160)*E.SC,
     E.rnd(.6,1.4),E.rnd(1.5,4)*E.SC,.65,.5,1.3,E.rnd(.3,.6),0,{drag:.5});
   }
  }
  spark.update(dt,t,null);
  smoke.update(dt,t,null);
 },
 drawField(t){
  if(!prog||!prog.p)return;
  const g=E.gl;
  g.useProgram(prog.p);
  g.uniform2f(prog.uRes,E.W,E.H);
  g.uniform2f(prog.uHit,st.hx||E.W*0.5,st.hy||E.H*0.3);
  g.uniform1f(prog.uTime,t);
  g.uniform1f(prog.uScorch,st.scorch);
  g.uniform1f(prog.uCol,st.colF);
  g.uniform1f(prog.uRing,st.ring);
  g.uniform1f(prog.uA1,st.a1||0);
  g.uniform1f(prog.uA2,st.a2||0);
  E.drawTri();
 },
 drawParticles(){
  const g=E.gl;
  const ranges=[];let vi=0;
  for(const b of bolts){
   if(!b.active)continue;
   const age=st.timer-b.t0;
   let bright=Math.min(1,age/0.034);
   if(age>0.15)bright=(0.35+0.65*Math.random())*Math.exp(-(age-0.15)*5.5);
   const start=vi/FPV;
   for(let i=0;i<NSEG;i++){
    const u=i/(NSEG-1);
    const w=b.w*(0.55+0.45*Math.sin(Math.PI*Math.min(u*3,1))) ;
    const px=b.bx[i],py=b.by[i];
    verts[vi++]=px+b.nx[i]*w;verts[vi++]=py+b.ny[i]*w;
    verts[vi++]=u;verts[vi++]=0;verts[vi++]=bright;
    verts[vi++]=px-b.nx[i]*w;verts[vi++]=py-b.ny[i]*w;
    verts[vi++]=u;verts[vi++]=1;verts[vi++]=bright;
   }
   ranges.push({start,count:NSEG*2});
  }
  if(ranges.length&&bprog&&bprog.p){
   g.useProgram(bprog.p);
   g.uniform2f(bprog.uRes,E.W,E.H);
   g.blendFunc(g.SRC_ALPHA,g.ONE);
   g.bindVertexArray(vao);
   g.bindBuffer(g.ARRAY_BUFFER,vbo);
   g.bufferSubData(g.ARRAY_BUFFER,0,verts.subarray(0,vi));
   for(const r of ranges)g.drawArrays(g.TRIANGLE_STRIP,r.start,r.count);
   g.bindVertexArray(null);
  }
  E.drawPool(spark,E.ADD());
  E.drawPool(smoke,E.ALPHA());
 },
 countParticles(){
  let rib=0;for(const b of bolts)if(b.active)rib+=NSEG;
  return spark.n+smoke.n+rib;
 }
});
})();
(function(){
"use strict";
const A=window.__ARC,E=A.env;
const FS=[
'#version 300 es','precision highp float;','#define TAU 6.2831853',
'uniform vec2 uRes,uC,uOrb;',
'uniform float uTime,uDeploy,uSig,uSpin,uOrbR,uOrbA,uYsq;',
'out vec4 o;',E.NOISE,
'void main(){',
' float mn=min(uRes.x,uRes.y);',
' vec2 fc=(gl_FragCoord.xy-uC)/mn;',
' vec2 gp=vec2(fc.x,fc.y/uYsq);',
' float d=length(gp);float ang=atan(gp.y,gp.x)+uSpin*0.25;',
' vec3 col=mix(vec3(.008,.014,.026),vec3(.002,.004,.010),clamp(fc.y*.6+.5,0.,1.));',
' col+=vec3(.03,.06,.10)*exp(-d*2.4)*.5;',
' float MR=0.95*uDeploy;',
' float rev=1.-smoothstep(MR,MR+.05,d);',
' float gate=rev*smoothstep(0.,.12,uDeploy);',
/* ── six-fold snowflake ── fold angle into a 60° wedge */
' float seg=TAU/6.;',
' float aa=mod(ang,seg)-seg*0.5;',
' float lat=abs(sin(aa))*d;',                                  /* lateral dist from arm centerline */
' float L=0.;',
/* main dendrite spine */
' L+=(1.-smoothstep(.006,.013,lat))*smoothstep(.05,.10,d)*(1.-smoothstep(MR*.92,MR,d))*0.9;',
/* side branches at three radii (diagonal twigs) */
' for(int k=1;k<4;k++){float rk=0.26*float(k)*uDeploy;',
'  float win=1.-smoothstep(.0,.075,abs(d-rk));',
'  float bl=abs(lat-(d-rk)*0.65);',                            /* 33°-ish twig */
'  L+=(1.-smoothstep(.004,.010,bl))*win*0.7;',
'  L+=exp(-pow((d-rk)*60.,2.))*(1.-smoothstep(.012,.02,lat))*0.35;', /* node bead */
' }',
/* hexagonal frame ring (radius modulated 6-fold) */
' float hexR=MR*0.86+0.018*cos(6.0*ang);',
' L+=exp(-pow((d-hexR)*55.,2.))*0.55;',
' float innerHex=MR*0.34+0.01*cos(6.0*ang);',
' L+=exp(-pow((d-innerHex)*70.,2.))*0.4;',
/* crystalline core */
' L+=exp(-pow(d/.028,2.))*0.6;',
' L*=.82+.3*n2(gp*26.+vec2(0.,uTime*.25));',
' L=min(L,1.3)*gate;',
' vec3 sc=mix(vec3(.14,.40,.56),vec3(.40,.74,.95),smoothstep(.0,.7,1.-d));',
' col+=sc*L*uSig;',
' col+=vec3(.04,.12,.18)*exp(-d*3.0)*gate*uSig*0.3;',
/* frost creep from the outer edges inward (rimed vignette) */
' float frost=smoothstep(.55,1.05,length(fc))*uSig;',
' float fcry=smoothstep(.6,1.,n2(fc*22.+vec2(uTime*.1,0.)));',
' col+=vec3(.20,.42,.58)*frost*fcry*0.5;',
/* hovering frozen orb */
' if(uOrbA>0.001){',
'  vec2 sv=(gl_FragCoord.xy-uOrb)/mn;float od=length(sv);float oa=atan(sv.y,sv.x);',
'  float body=1.-smoothstep(uOrbR*.5,uOrbR,od);',
'  float core2=1.-smoothstep(.0,uOrbR*.5,od);',
'  float fres=smoothstep(uOrbR*.6,uOrbR*.95,od)*(1.-smoothstep(uOrbR*.95,uOrbR*1.12,od));',
'  float facet=smoothstep(.55,1.,abs(sin(oa*3.+od*22.-uTime*1.2)));', /* crystalline facets */
'  vec3 oc=vec3(.18,.40,.56)*body*(.4+.3*facet);',
'  oc+=vec3(.34,.64,.82)*core2*.55;',
'  oc+=vec3(.40,.72,.96)*fres*.8;',
'  col+=oc*uOrbA;',
' }',
' col+=(h21(fc*uRes+uTime)-.5)*.010;',
' o=vec4(col,1.);',
'}'
].join('\n');
const shard=new E.Pool(640),mote=new E.Pool(384),burst=new E.Pool(512);
let prog=null;const NODE=36;const nodes=[];
const st={phase:0,timer:0,cx:0,cy:0,rx:0,ry:0,spin:0,spinV:0,deploy:0,sig:0,orbA:0,orbR:0,orbY:0,floorY:0,moteAcc:0};
function buildNodes(){nodes.length=0;for(let k=0;k<NODE;k++)nodes.push({ang0:k/NODE*E.TAU+E.rnd(-.04,.04),sz:E.rnd(.7,1.2),wob:E.rnd(.01,.03),ph:Math.random()*E.TAU});}
function geom(){st.cx=E.W*0.5;st.cy=E.H*0.46;const mn=Math.min(E.W,E.H);st.rx=mn*0.42;st.ry=mn*0.42*0.55;st.orbR=mn*0.07;st.floorY=st.cy;}
function burstFn(p,i){if(p.py[i]<st.floorY&&p.vy[i]<0){p.py[i]=st.floorY;p.vy[i]*=-0.3;p.vx[i]*=0.7;}}
function deploy(){st.phase=1;st.timer=0;E.flashAdd(.25,.45,.65,.8);E.shakeAdd(6*E.SC);E.setCA(.003);
 for(let i=0;i<70;i++){const a=Math.random()*E.TAU;const s=E.rnd(140,560)*E.SC;
  burst.spawn(st.cx,st.cy,Math.cos(a)*s,Math.sin(a)*s*0.5,E.rnd(.5,1.0),E.rnd(3,11)*E.SC,.34,.62,.85,E.rnd(.4,.7),2,{rot:Math.random()*E.TAU,rv:E.rnd(-5,5),drag:2.6});}}
A.reg({
 id:'NX-08',name:'육각 빙결 성문',en:'Hexagonal Frost Sigil',
 desc:'명확한 컨셉 — 육방 대칭 눈꽃(스노우플레이크) 마법진. 중심에서 6갈래 덴드라이트 척추가 뻗고 33° 잔가지·노드 비드가 자라며, 육각 외륜·내륜이 결정처럼 닫힌다. 가장자리에서 서리가 안쪽으로 결정화(라임 비네트), 결정 패싯 호버 오브, 궤도 얼음 파편 점가속→등속. 청록 결정 팔레트·저블룸 가독.',
 tech:['Six-Fold Snowflake SDF','Dendrite Spine + Twigs','Hexagonal Frame Rings','Inward Frost Creep','Faceted Frozen Orb','Orbital Ice Shards'],
 bloom:0.42,
 init(){prog=E.U(E.mkProg(E.FS_VERT,FS,'NX08'),['uRes','uC','uOrb','uTime','uDeploy','uSig','uSpin','uOrbR','uOrbA','uYsq']);buildNodes();geom();},
 reset(){shard.clear();mote.clear();burst.clear();st.phase=0;st.timer=0;st.spin=0;st.spinV=0;st.deploy=0;st.sig=0;st.orbA=0;st.moteAcc=0;geom();},
 resize(){geom();},
 autoPoint(){return [E.W*0.5,E.H*0.46];},
 trigger(x,y){if(st.phase!==0&&st.phase!==2)return;st.cx=x;st.cy=E.clamp(y,E.H*0.34,E.H*0.62);st.floorY=st.cy;deploy();},
 update(dt,t){
  st.timer+=dt;st.spinV=E.lerp(st.spinV,0.42,1-Math.exp(-dt*1.1));st.spin+=st.spinV*dt;
  if(st.phase===0){st.sig=Math.max(0,st.sig-dt);st.deploy=Math.max(0,st.deploy-dt*1.2);st.orbA=Math.max(0,st.orbA-dt*1.2);}
  else if(st.phase===1){const u=Math.min(1,st.timer/1.4);st.deploy=E.easeOutCubic(u);st.sig=Math.min(1,st.sig+dt*1.4);st.orbA=Math.min(1,st.orbA+dt);if(u>=1){st.phase=2;st.timer=0;}}
  else{st.sig=Math.min(1,st.sig+dt);st.orbA=Math.min(1,st.orbA+dt*.8);st.deploy=1;if(st.timer>6){st.phase=0;st.timer=0;}}
  st.orbY=st.cy+Math.min(E.W,E.H)*0.155+Math.sin(t*1.5)*Math.min(E.W,E.H)*0.016;
  st.moteAcc+=dt;const want=st.sig>0.4?0.06:9;
  while(st.moteAcc>want&&mote.n<260){st.moteAcc-=want;const a=Math.random()*E.TAU,rr=E.rnd(.1,.95)*st.rx;
   mote.spawn(st.cx+Math.cos(a)*rr,st.cy+Math.sin(a)*rr*0.55,E.rnd(-12,12)*E.SC,E.rnd(14,52)*E.SC,E.rnd(1.4,3.0),E.rnd(2,4)*E.SC,.44,.72,.94,E.rnd(.15,.4)*st.sig,0,{drag:.5,grav:-22*E.SC});}
  mote.update(dt,t,null);burst.update(dt,t,burstFn);
  shard.clear();
  for(let k=0;k<NODE;k++){const nd=nodes[k];const a=nd.ang0+st.spin;const fr=Math.sin(a);const depth=0.5+0.5*fr;
   const wob=1+Math.sin(t*2.0+nd.ph)*nd.wob;const x=st.cx+Math.cos(a)*st.rx*wob;const y=st.cy+Math.sin(a)*st.ry*wob;
   const sz=nd.sz*(0.5+0.7*depth)*E.SC*st.deploy;if(sz<0.3)continue;const al=(0.30+0.70*depth)*st.sig;
   shard.spawn(x,y,0,0,1,sz*3.6,.18,.40,.56,al*.12,0,{});
   shard.spawn(x,y,0,0,1,sz*3.0,.44,.72,.92,al*.55,2,{rot:a*1.4+nd.ph});
   shard.spawn(x,y,0,0,1,sz*1.2,.60,.82,1.0,al*.35,0,{});}
 },
 drawField(t){if(!prog||!prog.p)return;const g=E.gl;g.useProgram(prog.p);
  g.uniform2f(prog.uRes,E.W,E.H);g.uniform2f(prog.uC,st.cx||E.W*0.5,st.cy||E.H*0.46);
  g.uniform2f(prog.uOrb,st.cx||E.W*0.5,st.orbY||E.H*0.6);g.uniform1f(prog.uTime,t);
  g.uniform1f(prog.uDeploy,st.deploy);g.uniform1f(prog.uSig,st.sig);g.uniform1f(prog.uSpin,st.spin);
  g.uniform1f(prog.uOrbR,st.orbR||60);g.uniform1f(prog.uOrbA,st.orbA);g.uniform1f(prog.uYsq,0.55);E.drawTri();},
 drawParticles(){E.drawPool(mote,E.ADD());E.drawPool(burst,E.ADD());E.drawPool(shard,E.ADD());},
 countParticles(){return shard.n+mote.n+burst.n;}
});
})();
(function(){
"use strict";
const A=window.__ARC,E=A.env;
const FS=[
'#version 300 es','precision highp float;','#define TAU 6.2831853',
'uniform vec2 uRes,uC;uniform float uTime,uOpen,uPulse,uSpin;',
'out vec4 o;',E.NOISE,
'void main(){',
' float mn=min(uRes.x,uRes.y);',
' vec2 p=(gl_FragCoord.xy-uC)/mn;',
' float d=length(p);float a=atan(p.y,p.x);',
' vec3 col=mix(vec3(.020,.018,.040),vec3(.003,.004,.014),clamp(d,0.,1.));',
/* painterly domain-warped spiral arms */
' float ld=log(max(d,1e-3));',
' float warp=fbm2(p*2.6+vec2(uSpin*.25,-uSpin*.18));',
' float arms=sin(a*3.+ld*6.0-uSpin*2.0+warp*1.6);',
' float bound=uOpen*(1.-smoothstep(uOpen*0.9,uOpen*1.05+.05,d));',
' float armI=smoothstep(.25,.92,arms)*bound*(1.-smoothstep(.0,.95,d));',
' vec3 fluid=mix(vec3(.08,.42,.55),vec3(.42,.18,.66),clamp(warp*1.2,0.,1.));',
' col+=fluid*armI*0.85;',
/* secondary fine swirl detail */
' float arm2=sin(a*5.-ld*9.0+uSpin*3.0-warp*2.0);',
' col+=vec3(.20,.55,.7)*smoothstep(.6,.98,arm2)*bound*(1.-smoothstep(.0,.7,d))*0.4;',
/* luminous eye */
' float eye=exp(-d*d*42.);',
' col+=vec3(.55,.82,.98)*eye*uOpen*1.1;',
' col+=vec3(.35,.25,.6)*exp(-d*d*10.)*uOpen*0.5;',
/* vortex mouth rim */
' col+=vec3(.30,.62,.82)*exp(-pow((d-uOpen*0.92)*9.,2.))*uOpen*0.6;',
/* release pulse */
' col+=vec3(.6,.85,1.05)*exp(-pow((d-uPulse*1.25)*7.,2.))*(1.-uPulse)*1.3;',
' col+=(h21(p*uRes+uTime)-.5)*.011;',
' o=vec4(col,1.);',
'}'
].join('\n');
const mote=new E.Pool(768);  /* inward-spiraling translucent fluid motes */
const glow=new E.Pool(512);   /* additive spark cores */
let prog=null;
const st={phase:0,timer:0,cx:0,cy:0,open:0,pulse:0,spin:0,spinV:0,acc:0,R:0,pulseAcc:0};
function geom(){st.cx=E.W*0.5;st.cy=E.H*0.5;st.R=Math.min(E.W,E.H)*0.46;}
function vfn(p,i,dt,t){
 const dx=p.px[i]-st.cx,dy=p.py[i]-st.cy;const r=Math.hypot(dx,dy)||1;
 const ux=dx/r,uy=dy/r;
 const pull=(420+260*(1-Math.min(1,r/st.R)))*E.SC;
 const swirl=(900*Math.min(1,st.R/Math.max(r,40)))*E.SC*(0.7+0.3*st.open);
 p.vx[i]+=(-ux*pull + -uy*swirl)*dt;
 p.vy[i]+=(-uy*pull +  ux*swirl)*dt;
 p.vx[i]*=Math.exp(-1.4*dt);p.vy[i]*=Math.exp(-1.4*dt);
 if(r<14*E.SC&&st.open>0.1){ // recycle outward only while open (GC0); else let expire
  const a=Math.random()*E.TAU,rr=st.R*E.rnd(.85,1.05);
  p.px[i]=st.cx+Math.cos(a)*rr;p.py[i]=st.cy+Math.sin(a)*rr;
  const tsp=E.rnd(60,160)*E.SC;p.vx[i]=-Math.sin(a)*tsp;p.vy[i]=Math.cos(a)*tsp;
  p.life[i]=p.maxLife[i];
 }
}
function gfn(p,i,dt,t){vfn(p,i,dt,t);}
function spawnRing(pool,n,alpha,shape,sz){
 for(let i=0;i<n;i++){const a=Math.random()*E.TAU,rr=st.R*E.rnd(.8,1.08);
  const tsp=E.rnd(60,170)*E.SC;const m=Math.random();
  pool.spawn(st.cx+Math.cos(a)*rr,st.cy+Math.sin(a)*rr,-Math.sin(a)*tsp,Math.cos(a)*tsp,
   E.rnd(3,7),E.rnd(sz[0],sz[1])*E.SC,.18+m*.3,.55+m*.35,.7+m*.3,E.rnd(alpha[0],alpha[1]),shape,{seed:Math.random()});}
}
function release(){
 st.pulse=0.001;E.flashAdd(.45,.7,.95,.9);E.shakeAdd(16*E.SC);E.setCA(.010);
 for(let i=0;i<160;i++){const a=Math.random()*E.TAU,s=E.rnd(500,1500)*E.SC;
  glow.spawn(st.cx,st.cy,Math.cos(a)*s,Math.sin(a)*s,E.rnd(.5,1.1),E.rnd(3,9)*E.SC,.5,.8,1.05,E.rnd(.6,.9),0,{drag:3.5,seed:Math.random()});}
}
A.reg({
 id:'NX-10',name:'심연 와류',en:'Abyssal Vortex',
 desc:'공간이 휘말리는 반투명 유체 소용돌이 — 로그 나선 팔이 도메인 워프로 회화적 유동, 청록↔보라 간섭. 입자가 접선+구심 가속으로 내향 나선(GC0 재활용), 중심 발광 안(eye) 형성 후 주기적 충격 방출. 비대칭·동적.',
 tech:['Log-Spiral Domain Warp','Painterly Fluid Interference','Tangential+Centripetal Drift','GC0 Inward Recycle','Luminous Eye','Periodic Release Pulse'],
 bloom:0.78,
 init(){prog=E.U(E.mkProg(E.FS_VERT,FS,'NX10'),['uRes','uC','uTime','uOpen','uPulse','uSpin']);geom();},
 reset(){mote.clear();glow.clear();st.phase=0;st.timer=0;st.open=0;st.pulse=0;st.spin=0;st.spinV=0;st.acc=0;st.pulseAcc=0;geom();},
 resize(){geom();},
 autoPoint(){return [E.W*0.5,E.H*0.5];},
 trigger(x,y){if(st.phase!==0&&st.phase!==2)return;st.cx=x;st.cy=E.clamp(y,E.H*0.3,E.H*0.7);
  st.phase=1;st.timer=0;E.setCA(.004);spawnRing(mote,300,[.12,.32],3,[3,7]);spawnRing(glow,110,[.4,.7],0,[2,5]);}, 
 update(dt,t){
  st.timer+=dt;st.spinV=E.lerp(st.spinV,0.9,1-Math.exp(-dt*0.8));st.spin+=st.spinV*dt;
  if(st.phase===0){st.open=Math.max(0,st.open-dt*0.8);st.pulse=st.pulse>0?Math.min(1,st.pulse+dt*1.8):0;if(st.pulse>=1)st.pulse=0;}
  else if(st.phase===1){st.open=Math.min(1,E.easeOutCubic(Math.min(1,st.timer/0.85)));
   st.acc+=dt*40;while(st.acc>1&&mote.n<660){st.acc--;const a=Math.random()*E.TAU,rr=st.R*E.rnd(.85,1.08),tsp=E.rnd(60,170)*E.SC;
    mote.spawn(st.cx+Math.cos(a)*rr,st.cy+Math.sin(a)*rr,-Math.sin(a)*tsp,Math.cos(a)*tsp,E.rnd(3,7),E.rnd(3,7)*E.SC,.2,.6,.75,E.rnd(.12,.32),3,{seed:Math.random()});}
   if(st.timer>1.0){st.phase=2;st.timer=0;}}
  else if(st.phase===2){st.open=1;
   st.acc+=dt*30;while(st.acc>1&&mote.n<660){st.acc--;const a=Math.random()*E.TAU,rr=st.R*E.rnd(.85,1.08),tsp=E.rnd(60,170)*E.SC;
    mote.spawn(st.cx+Math.cos(a)*rr,st.cy+Math.sin(a)*rr,-Math.sin(a)*tsp,Math.cos(a)*tsp,E.rnd(3,7),E.rnd(3,7)*E.SC,.2,.6,.75,E.rnd(.12,.32),3,{seed:Math.random()});}
   st.pulseAcc+=dt;if(st.pulseAcc>1.6){st.pulseAcc=0;release();}
   if(st.pulse>0){st.pulse=Math.min(1,st.pulse+dt*1.4);if(st.pulse>=1)st.pulse=0;}
   if(st.timer>6.5){st.phase=3;st.timer=0;release();}}
  else{st.open=Math.max(0,st.open-dt*1.3);if(st.pulse>0){st.pulse=Math.min(1,st.pulse+dt*1.2);if(st.pulse>=1)st.pulse=0;}if(st.timer>1.4){st.phase=0;st.timer=0;}}
  mote.update(dt,t,vfn);glow.update(dt,t,gfn);
 },
 drawField(t){if(!prog||!prog.p)return;const g=E.gl;g.useProgram(prog.p);
  g.uniform2f(prog.uRes,E.W,E.H);g.uniform2f(prog.uC,st.cx||E.W*0.5,st.cy||E.H*0.5);
  g.uniform1f(prog.uTime,t);g.uniform1f(prog.uOpen,st.open);g.uniform1f(prog.uPulse,st.pulse);g.uniform1f(prog.uSpin,st.spin);E.drawTri();},
 drawParticles(){E.drawPool(mote,E.ALPHA());E.drawPool(glow,E.ADD());},
 countParticles(){return mote.n+glow.n;}
});
})();
(function(){
"use strict";
const A=window.__ARC,E=A.env;
const FS=`#version 300 es
precision highp float;
out vec4 o;
uniform vec2 uRes; uniform float uTime,uRend,uOpen,uFade;
const float PI=3.14159265;
float hh(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float hh3(vec3 p){ return fract(sin(dot(p,vec3(17.1,113.5,71.7)))*43758.5453); }
float nn(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(hh(i),hh(i+vec2(1,0)),f.x),mix(hh(i+vec2(0,1)),hh(i+vec2(1,1)),f.x),f.y); }
float fbm(vec2 p){ float s=0.,a=.5; for(int i=0;i<5;i++){s+=a*nn(p);p*=2.04;a*=.5;} return s; }
float ridged(vec2 p){ return 1.-abs(fbm(p)*2.-1.); }
// shard cell id via jittered grid (cheap voronoi-ish)
vec3 cell(vec2 uv){
  vec2 g=floor(uv*5.0); vec2 f=fract(uv*5.0);
  float md=10.; vec2 mc=vec2(0.); vec2 mg=vec2(0.);
  for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++){
    vec2 go=vec2(float(x),float(y));
    vec2 jit=vec2(hh(g+go),hh(g+go+7.3));
    vec2 d=go+jit-f; float dd=dot(d,d);
    if(dd<md){ md=dd; mc=g+go+jit; mg=g+go; }
  }
  return vec3(mc, hh(mg+3.1));
}
void main(){
  vec2 uv=((gl_FragCoord.xy/uRes)*2.-1.); uv.x*=uRes.x/uRes.y;
  // base reality: warm marbled plane
  float bf=fbm(uv*1.8+vec2(uTime*0.04,-uTime*0.03));
  vec3 base=mix(vec3(0.10,0.07,0.13),vec3(0.30,0.22,0.36),bf);
  // crack network propagating from center, ridged fbm gated by radius front
  float r=length(uv);
  float front=uRend*1.6;
  float cr=ridged(uv*3.4+vec2(2.0,1.0));
  float crackMask=smoothstep(0.62,0.84,cr)*(1.-smoothstep(front-0.15,front,r));
  // void beneath: starfield + nebula
  float stars=pow(hh(floor(uv*70.+0.5)),60.)*8.0;
  float neb=fbm(uv*1.2+vec2(5.0,uTime*0.03));
  vec3 void_=vec3(0.02,0.03,0.08)+vec3(0.10,0.05,0.30)*neb+vec3(0.7,0.8,1.0)*stars;
  // shards displace outward (open), revealing void in gaps
  vec3 c=cell(uv);
  vec2 cc=c.xy*0.2;                                   // approx cell center in uv space (grid 5)
  vec2 dir=normalize(uv-cc+1e-4);
  float disp=uOpen*0.10*(0.4+c.z);
  vec2 su=uv - dir*disp;                              // sample displaced shard
  float bf2=fbm(su*1.8+vec2(uTime*0.04,-uTime*0.03));
  vec3 shard=mix(vec3(0.10,0.07,0.13),vec3(0.30,0.22,0.36),bf2);
  // gap factor = how far this fragment lies in opened seam
  float seam=smoothstep(0.0,0.06,disp* (0.5+0.5*sin(c.z*30.)) )*uOpen;
  float gap=crackMask + seam*0.7;
  gap=clamp(gap,0.,1.);
  // chromatic aberration along crack edges
  float caAmt=crackMask*0.02*uRend;
  vec3 col;
  col.r=mix(shard, void_, gap).r;
  col.g=mix(shard, void_, clamp(gap+caAmt,0.,1.)).g;
  col.b=mix(shard, void_, clamp(gap-caAmt,0.,1.)).b;
  // glowing rift seam
  float glow=crackMask*(0.6+0.4*sin(uTime*8.+r*20.));
  col+=vec3(0.6,0.85,1.0)*glow*1.4*uRend;
  // initial tear flash line (vertical seam)
  float seamLine=1.-smoothstep(0.,0.02+0.4*(1.-uRend),abs(uv.x));
  col+=vec3(0.8,0.9,1.0)*seamLine*uRend*(1.-uOpen)*1.5;
  col*=(1.-dot(uv*.32,uv*.32))*uFade;
  col=pow(max(col,0.),vec3(0.93))*1.06;
  col=mix(vec3(dot(col,vec3(0.299,0.587,0.114))),col,1.15);
  o=vec4(col,1.);
}`;
let prog=null; const st={t:0};
A.reg({
 id:'ARC-22',name:'차원 균열',en:'Reality Rend',
 desc:'봉합선이 찢어지며 균열이 전파→파편이 열려 공허/별빛 노출→치유. 차원 단절 + CA. opus 포팅.',
 tech:['Seam Tear','Crack Propagation','Void/Starfield Exposure','Heal Cycle'],bloom:1.0,
 init(){prog=E.U(E.mkProg(E.FS_VERT,FS,'ARC22'),['uRes','uTime','uRend','uOpen','uFade']);},
 reset(){st.t=0;}, resize(){},
 autoPoint(){return [E.W*0.5,E.H*0.5];},
 trigger(x,y){st.t=0;},
 update(dt,t){st.t+=dt;},
 drawField(t){if(!prog||!prog.p)return;const g=E.gl;g.useProgram(prog.p);
  g.uniform2f(prog.uRes,E.W,E.H);g.uniform1f(prog.uTime,st.t);
  const P=9.0,ph=st.t%P;let rend,open,fade=1;if(ph<0.7){rend=E.smoothstep(0,0.7,ph);open=0;}else if(ph<3.0){rend=1;open=E.smoothstep(0.7,3.0,ph);}else if(ph<6.0){rend=1;open=1;}else if(ph<7.5){rend=1;open=1-E.smoothstep(6.0,7.5,ph);}else{rend=1-E.smoothstep(7.5,9.0,ph);open=0;fade=1-E.smoothstep(7.5,9.0,ph);}g.uniform1f(prog.uRend,rend);g.uniform1f(prog.uOpen,open);g.uniform1f(prog.uFade,fade);
  E.drawTri();},
 drawParticles(){}, countParticles(){return 0;}
});
})();
(function(){
"use strict";
const A=window.__ARC,E=A.env;
const FS=`#version 300 es
precision highp float;
out vec4 o;
uniform vec2 uRes; uniform float uTime,uGray,uTear,uKick,uFade;
uniform vec3 uDraw,uGlow;
const float PI=3.14159265;
float hh(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float nn(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(hh(i),hh(i+vec2(1,0)),f.x),mix(hh(i+vec2(0,1)),hh(i+vec2(1,1)),f.x),f.y); }
float fbm(vec2 p){ float s=0.,a=.5; for(int i=0;i<5;i++){s+=a*nn(p);p*=2.1;a*=.5;} return s; }
// 초승달 참격: x=코어 y=글로우 z=헤드섬광 w=부호거리
vec4 slashGeo(vec2 uv, vec2 dir, float off, float curv, float drawP){
  vec2 tg=vec2(dir.y,-dir.x);
  float q=clamp(dot(uv,tg)*0.40+0.5,0.,1.);                 // 0..1 스트로크 종방향
  float sd=dot(uv,dir)-off + curv*((q-0.5)*(q-0.5)-0.08);   // 완만한 곡률
  float wT=max(sin(q*PI),0.05);                             // 중앙 후육·양끝 테이퍼
  float head=drawP*1.30-0.12;
  float vis=(1.-smoothstep(head-0.02,head+0.012,q))*step(0.001,drawP);
  float headGl=(1.-smoothstep(0.,0.06,abs(q-head)))*(1.-smoothstep(0.85,1.0,drawP));
  float core=(1.-smoothstep(0.,0.0045*wT+0.0012,abs(sd)))*vis;
  float glow=(1.-smoothstep(0.,0.15*wT+0.015,abs(sd)))*vis;
  float headM=headGl*(1.-smoothstep(0.,0.10,abs(sd)));
  return vec4(core,glow,headM,sd);
}
void main(){
  vec2 uv=((gl_FragCoord.xy/uRes)*2.-1.); uv.x*=uRes.x/uRes.y;
  uv+=(vec2(hh(vec2(floor(uTime*67.),1.)),hh(vec2(floor(uTime*67.),7.)))-0.5)*uKick*0.045;
  // 탈색 스윕: 사선 파면이 세계를 단색으로 잠식
  vec2 gd=normalize(vec2(0.55,1.0));
  float s=dot(uv,gd);
  float front=1.9-uGray*4.4;
  float gM=smoothstep(front,front+0.45,s);
  float fl=(1.-smoothstep(0.,0.06,abs(s-front)))*step(0.01,uGray)*step(uGray,0.99);
  float n=fbm(uv*1.1+vec2(uTime*0.07,-uTime*0.05));
  vec3 base=vec3(n*0.13,n*0.09,n*0.20);
  vec2 sd1=normalize(vec2(1.,2.2));
  float pd=dot(uv,sd1);
  vec2 wu=uv+vec2(sin(uv.y*40.+uTime*8.)*0.026,cos(uv.x*30.-uTime*6.)*0.012)*exp(-abs(pd)*12.)*uTear;
  float nw=fbm(wu*1.1+vec2(uTime*0.07,-uTime*0.05));
  float lum=dot(base,vec3(.213,.715,.072));
  vec3 grayWorld=vec3(lum*1.7+0.04);
  vec3 grayWarp=vec3(nw*0.13*1.7+0.04);
  vec3 world=mix(base, mix(grayWorld,grayWarp,clamp(exp(-abs(pd)*12.)*uTear,0.,1.)), gM);
  world+=vec3(0.9,0.95,1.)*fl*0.35;                          // 파면 라인 글로우
  // 시차 삼연참(각기 곡률·각도 상이)
  vec4 s1=slashGeo(uv,sd1,0.0,0.16,uDraw.x);
  vec4 s2=slashGeo(uv,normalize(vec2(1.,1.4)),0.22,-0.13,uDraw.y);
  vec4 s3=slashGeo(uv,normalize(vec2(1.,3.2)),-0.28,0.10,uDraw.z);
  vec3 slash=vec3(0.);
  slash+=(vec3(1.,.03,.08)*s1.y*2.0+vec3(1.,.82,.84)*s1.x*1.3)*uGlow.x + vec3(1.,.97,.98)*s1.z*2.8;
  slash+=(vec3(1.,.05,.18)*s2.y*1.7+vec3(1.,.85,.90)*s2.x*1.2)*uGlow.y + vec3(1.,.96,.98)*s2.z*2.5;
  slash+=(vec3(.92,.02,.12)*s3.y*1.7+vec3(1.,.80,.86)*s3.x*1.2)*uGlow.z + vec3(1.,.95,.97)*s3.z*2.5;
  // 1참 가장자리 필라멘트
  float edge=(1.-smoothstep(0.,0.0018,abs(abs(s1.w)-0.005)))*uGlow.x;
  slash+=vec3(1.,.7,.9)*edge;
  // 균열이 벌어지며 드러나는 공허(적색 잔불 일렁임)
  float gapM=(1.-smoothstep(0.,max(0.020*clamp(uTear,0.,1.2),1e-3),abs(s1.w)))*step(0.02,uTear)*uGlow.x;
  vec3 voidCol=vec3(0.015,0.,0.03)+vec3(0.9,0.05,0.15)*fbm(uv*5.+vec2(0.,uTime*0.5))*0.55;
  world=mix(world,voidCol,clamp(gapM,0.,1.)*0.92);
  // 절단선 스파크 + 공허 부유 모트
  float qq=dot(uv,vec2(sd1.y,-sd1.x));
  float spk=step(0.95,hh(vec2(floor(qq*42.),floor(uTime*10.))))*(1.-smoothstep(0.,0.06,abs(s1.w)))*uGlow.x;
  slash+=vec3(1.,.4,.3)*spk*1.2;
  float mote=step(0.986,hh(floor(uv*15.+vec2(0.,-uTime*0.9)+0.5)))*(1.-smoothstep(0.,0.40,abs(pd)))*clamp(uTear,0.,1.);
  slash+=vec3(1.,.12,.22)*mote*1.3;
  // 균열 잔금(기존 연출 유지)
  float crack=step(0.71,fbm(uv*9.+sd1*4.5+uTime*0.05))*(1.-smoothstep(0.,0.30,abs(pd)));
  slash+=vec3(0.85,.05,.38)*crack*uGlow.x*0.55;
  vec3 col=(world+slash)*(1.-dot(uv*.34,uv*.34))*uFade;
  float L13=dot(col,vec3(0.299,0.587,0.114));
  col=mix(vec3(L13),col,0.88);
  col=pow(max(col,0.),vec3(0.90))*1.05;
  col.r+=max(col.r-L13,0.)*0.4;
  o=vec4(col,1.);
}`;
let prog=null; const st={t:0};
A.reg({
 id:'ARC-23',name:'절대 공허 참격',en:'Absolute Void Slash',
 desc:'세계 탈색(mono) 위로 3연 진홍 일섬이 그어지고 균열이 호흡하며 벌어짐(UV 찢김), 히트킥. opus 포팅.',
 tech:['World Desaturation','Triple Crimson Slash','Breathing Tear','Hit Kick'],bloom:0.9,
 init(){prog=E.U(E.mkProg(E.FS_VERT,FS,'ARC23'),['uRes','uTime','uGray','uTear','uKick','uFade','uDraw','uGlow']);},
 reset(){st.t=0;}, resize(){},
 autoPoint(){return [E.W*0.5,E.H*0.5];},
 trigger(x,y){st.t=0;},
 update(dt,t){st.t+=dt;},
 drawField(t){if(!prog||!prog.p)return;const g=E.gl;g.useProgram(prog.p);
  g.uniform2f(prog.uRes,E.W,E.H);g.uniform1f(prog.uTime,st.t);
  const P=8.5,ph=st.t%P;let fade=1;const d1=E.clamp((ph-1.05)/0.13,0,1),d2=E.clamp((ph-1.45)/0.13,0,1),d3=E.clamp((ph-1.85)/0.13,0,1);const rel=1-E.smoothstep(4.2,5.6,ph);const g1=E.smoothstep(1.05,1.18,ph)*rel,g2=E.smoothstep(1.45,1.58,ph)*rel,g3=E.smoothstep(1.85,1.98,ph)*rel;const gray=ph<6.0?E.smoothstep(0,0.9,ph):1-E.smoothstep(6.0,8.0,ph);const tear=E.smoothstep(2.0,3.4,ph)*(1+0.06*Math.sin(st.t*5))*rel;let kick=(ph>=1.05?Math.exp(-(ph-1.05)*9):0)+(ph>=1.45?Math.exp(-(ph-1.45)*9):0)+(ph>=1.85?Math.exp(-(ph-1.85)*9):0);kick=Math.min(kick,1);if(ph>=6.0)fade=1-E.smoothstep(6.0,8.5,ph);g.uniform1f(prog.uGray,gray);g.uniform1f(prog.uTear,tear);g.uniform1f(prog.uKick,kick);g.uniform1f(prog.uFade,fade);g.uniform3f(prog.uDraw,d1,d2,d3);g.uniform3f(prog.uGlow,g1,g2,g3);
  E.drawTri();},
 drawParticles(){}, countParticles(){return 0;}
});
})();
(function(){
"use strict";
const A=window.__ARC,E=A.env;
const FS=`#version 300 es
precision highp float;
out vec4 o;
uniform vec2 uRes; uniform float uTime,uPull,uFade;
const float PI=3.14159265;
float hh(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float nn(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(hh(i),hh(i+vec2(1,0)),f.x),mix(hh(i+vec2(0,1)),hh(i+vec2(1,1)),f.x),f.y); }
float fbm(vec2 p){ float s=0.,a=.5; for(int i=0;i<5;i++){s+=a*nn(p);p*=2.07;a*=.5;} return s; }
void main(){
  vec2 uv=((gl_FragCoord.xy/uRes)*2.-1.); uv.x*=uRes.x/uRes.y;
  float r=length(uv)+1e-4, th=atan(uv.y,uv.x);
  // inward spiral coordinate (negative = devouring), tightening over time
  float spin=uTime*0.9*uPull;
  float sp=th + 3.2*log(r) + spin;
  // toxic fog dragged inward along spiral
  vec2 warp=uv - normalize(uv)*(uPull*0.12)*(1.-smoothstep(0.,0.9,r));   // inhale displacement
  float fog=fbm(vec2(sp*0.6, r*3.0 - uTime*1.4*uPull) + warp*2.0);
  fog=pow(max(fog,0.),1.4)*(1.-smoothstep(0.05,0.95,r))*uPull;
  vec3 col=vec3(0.015,0.03,0.012);
  col+=vec3(0.05,0.70,0.16)*fog*1.3;                       // toxic green inflow
  col+=vec3(0.10,0.30,0.06)*fog*fog*1.2;
  // dark violet spiral petals (4 logarithmic arms) pulled toward core
  float arms=cos(sp*2.0)*0.5+0.5;
  float petal=pow(arms,3.0)*(1.-smoothstep(0.04,0.85,r))*uPull;
  col+=vec3(0.22,0.0,0.34)*petal*1.2;
  float edge=pow(arms,9.0)*(1.-smoothstep(0.04,0.8,r))*uPull;
  col+=vec3(0.62,0.05,0.85)*edge*1.0;                      // glowing arm rims
  // central singular maw: black hole rim
  float maw=1.-smoothstep(0.0,0.16,r);
  col*=mix(1.0, 0.0, maw*0.95*uPull);                      // swallow center
  float rim=1.-smoothstep(0.0,0.05,abs(r-0.16));
  col+=vec3(0.55,0.0,0.8)*rim*uPull*0.9;                    // violet event rim
  // faint inward streaks
  float streak=pow(max(sin(sp*6.0),0.),12.)*(1.-smoothstep(0.16,0.9,r))*uPull;
  col+=vec3(0.3,0.9,0.4)*streak*0.5;
  col*=(1.-smoothstep(0.7,1.15,r)*0.8)*uFade;
  o=vec4(col,1.);
}`;
let prog=null; const st={t:0};
A.reg({
 id:'ARC-24',name:'심연 연꽃 포식',en:'Abyssal Lotus Devourer',
 desc:'어둠의 연꽃이 피며 중심으로 모든 것을 끌어당기는 포식 인력(녹빛 독무). opus 포팅(보존종).',
 tech:['Dark Lotus','Devouring Pull','Toxic Fog'],bloom:0.85,
 init(){prog=E.U(E.mkProg(E.FS_VERT,FS,'ARC24'),['uRes','uTime','uPull','uFade']);},
 reset(){st.t=0;}, resize(){},
 autoPoint(){return [E.W*0.5,E.H*0.5];},
 trigger(x,y){st.t=0;},
 update(dt,t){st.t+=dt;},
 drawField(t){if(!prog||!prog.p)return;const g=E.gl;g.useProgram(prog.p);
  g.uniform2f(prog.uRes,E.W,E.H);g.uniform1f(prog.uTime,st.t);
  const P=10.0,ph=st.t%P;let pull,fade=1;if(ph<3.0)pull=E.smoothstep(0,3.0,ph);else if(ph<7.5)pull=1;else{pull=1-E.smoothstep(7.5,10.0,ph);fade=1-E.smoothstep(8.0,10.0,ph);}g.uniform1f(prog.uPull,pull);g.uniform1f(prog.uFade,fade);
  E.drawTri();},
 drawParticles(){}, countParticles(){return 0;}
});
})();
(function(){
"use strict";
const A=window.__ARC,E=A.env;
const FS=`#version 300 es
precision highp float;
out vec4 o;
uniform vec2 uRes; uniform float uTime,uPow,uFade;
const float PI=3.14159265,TAU=6.2831853;
float h2(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float n2(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(h2(i),h2(i+vec2(1,0)),f.x),mix(h2(i+vec2(0,1)),h2(i+vec2(1,1)),f.x),f.y); }
float fbm2(vec2 p){ float s=0.,a=.5; for(int i=0;i<5;i++){ s+=a*n2(p); p*=2.03; a*=.5; } return s; }
float ad(float a,float b){ float d=a-b; return mod(d+PI,TAU)-PI; }
void main(){
  vec2 uv=(gl_FragCoord.xy/uRes)*2.-1.; uv.x*=uRes.x/uRes.y;
  float r=length(uv), th=atan(uv.y,uv.x);
  float cl=fbm2(uv*1.6+vec2(uTime*0.05,0.));
  vec3 col=vec3(0.03+0.05*cl*cl, 0.03+0.04*cl*cl, 0.09+0.10*cl*cl);
  col*=1.-0.3*clamp(r,0.,1.);
  float shell=exp(-pow((r-0.18)/0.05,2.));
  float arc=fbm2(vec2(th/TAU*24.+uTime*3., r*8.));
  col+=vec3(0.5,0.8,1.2)*shell*arc*0.6*uPow;
  float core=exp(-pow(r/0.12,2.));
  col+=vec3(1.2,1.4,1.6)*core*(0.6+uPow);
  col+=vec3(0.0,0.7,1.0)*exp(-r/0.35)*0.4;
  float reach=0.82;
  for(int k=0;k<9;k++){ float fk=float(k); float th0=fk/9.*TAU;
    float fl=step(0.35,h2(vec2(fk*12.9, floor(uTime*6.)*7.7))); float flick=mix(0.25,1.0,fl);
    float dev=(fbm2(vec2(r*7.+fk*9.+uTime*4., fk*3.1))-0.5)*0.9*r;
    float ba=th0+dev/max(r,0.05); float dth=ad(th,ba);
    float radial=smoothstep(0.12,0.22,r)*(1.-smoothstep(reach,reach+0.12,r));
    float glow=exp(-pow(dth*r/0.015,2.))*radial*flick;
    col+=vec3(0.7,0.95,1.3)*glow*uPow;
    float dev2=(fbm2(vec2(r*12.+fk*5.+uTime*4., fk*7.))-0.5)*1.3*r;
    float ba2=th0+0.18+dev2/max(r,0.05); float dth2=ad(th,ba2);
    float glow2=exp(-pow(dth2*r/0.010,2.))*smoothstep(0.3,0.45,r)*(1.-smoothstep(0.7,0.8,r))*flick*0.5;
    col+=vec3(0.4,0.7,1.1)*glow2*uPow;
  }
  float cy=-0.55, Rx=0.72, Ry=0.16;
  float ed=length(vec2(uv.x/Rx,(uv.y-cy)/Ry));
  float ring=exp(-pow((ed-1.0)*7.,2.));
  float ti=pow(clamp(0.5+0.5*sin(atan((uv.y-cy)/Ry,uv.x/Rx)*24.+uTime*0.5),0.,1.),8.);
  col+=vec3(0.3,0.6,1.0)*ring*(0.6+ti*0.8);
  col+=(h2(uv*uRes.xy*0.7+uTime)-0.5)*0.012;
  col*=uFade;
  o=vec4(col,1.);
}`;
let prog=null; const st={t:0};
A.reg({
 id:'ARC-26',name:'뇌격 결계',en:'Thunder Ward',
 desc:'전기 코어(맥동 충전→방전 버스트) + 9갈래 유기적 뇌격(FBM jagged·분기) + 셸 아크 + 원근 발광 결계링(룬 틱) + 폭풍 배경. 평면 라디얼(opus v5 구버전) 적용. 직선 레이저 아님.',
 tech:['Pulsing Electric Core','9 Organic FBM Bolts','Branch Forks','Perspective Ward Ring','Storm Backdrop'],bloom:0.95,
 init(){prog=E.U(E.mkProg(E.FS_VERT,FS,'ARC26'),['uRes','uTime','uPow','uFade']);},
 reset(){st.t=0;},
 resize(){},
 autoPoint(){return [E.W*0.5,E.H*0.5];},
 trigger(x,y){st.t=0;},
 update(dt,t){st.t+=dt;},
 drawField(t){if(!prog||!prog.p)return;const g=E.gl;g.useProgram(prog.p);
  g.uniform2f(prog.uRes,E.W,E.H);g.uniform1f(prog.uTime,st.t);
  let fade=1;{const ph=st.t%10.0;if(ph<1.0)fade=E.smoothstep(0,1.0,ph);else if(ph>=8.5)fade=1-E.smoothstep(8.5,10.0,ph);}g.uniform1f(prog.uPow,0.45+0.55*Math.pow(0.5+0.5*Math.sin(st.t*0.9),3.0));g.uniform1f(prog.uFade,fade);
  E.drawTri();},
 drawParticles(){},
 countParticles(){return 0;}
});
})();
(function(){
"use strict";
const A=window.__ARC,E=A.env;
const FS=`#version 300 es
precision highp float;
out vec4 o;
uniform vec2 uRes; uniform float uTime,uFade;
float h2(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float n2(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(h2(i),h2(i+vec2(1,0)),f.x),mix(h2(i+vec2(0,1)),h2(i+vec2(1,1)),f.x),f.y); }
float fbm(vec2 p){ float s=0.,a=.5; for(int i=0;i<5;i++){ s+=a*n2(p); p*=2.03; a*=.5; } return s; }
void main(){
  vec2 uv=gl_FragCoord.xy/uRes*2.-1.; uv.x*=uRes.x/uRes.y;
  float r=length(uv);
  float wx=fbm(uv*1.5+vec2(uTime*0.05,0.)), wy=fbm(uv*1.5+vec2(5.,-uTime*0.05));
  vec2 q=uv+(vec2(wx,wy)-0.5)*0.6;
  float crust=fbm(q*2.2);
  float rg=fbm(q*3.0+10.);
  float vein=pow(1.-abs(rg*2.-1.),3.0);
  float flow=0.5+0.5*sin(rg*20.-uTime*2.0);
  float heat=vein*(0.4+0.6*flow);
  float pool=1.-smoothstep(0.0,0.9,r);
  float molten=clamp(heat*pool + (1.-smoothstep(0.0,0.25,r))*1.2, 0., 2.);
  float rock=0.06+0.10*crust;
  vec3 base=vec3(rock*0.9,rock*0.7,rock*0.8)*clamp(1.-pool*0.6,0.2,1.);
  float m=clamp(molten,0.,1.6);
  vec3 lava=vec3(clamp(m*1.4,0.,1.3),clamp((m-0.35)*1.2,0.,1.1),clamp((m-0.8)*1.4,0.,1.0));
  vec3 col=base+lava;
  float embers=step(0.93,n2(q*22.+vec2(uTime*0.5,-uTime*1.5)))*pool;
  col+=vec3(0.8,0.4,0.0)*embers;
  float core=exp(-pow(r/0.12,2.));
  col+=vec3(1.2,1.0,0.7)*core;
  col*=1.-smoothstep(0.7,1.25,r)*0.7;
  col+=(h2(uv*uRes+uTime)-0.5)*0.012;
  col*=uFade;
  o=vec4(col,1.);
}`;
let prog=null; const st={t:0};
A.reg({
 id:'ARC-27',name:'용암 개화',en:'Molten Bloom',
 desc:'암흑 지각을 가르고 흐르는 용암 베인(리지드 노이즈 협곡)이 맥동·확산, 백열 코어·잔열 연기·상승 잉걸. 도메인 워프 fbm 유동, 적·주황·황금 그라데이션. 천체의식 폐기 후 신주제.',
 tech:['Domain-Warp Lava Veins','Ridged Heat Network','White-Hot Core','Ember Glow','Warm Grade'],bloom:0.95,
 init(){prog=E.U(E.mkProg(E.FS_VERT,FS,'ARC27'),['uRes','uTime','uFade']);},
 reset(){st.t=0;},
 resize(){},
 autoPoint(){return [E.W*0.5,E.H*0.5];},
 trigger(x,y){ st.t=0; },
 update(dt,t){st.t+=dt;},
 drawField(t){if(!prog||!prog.p)return;const g=E.gl;g.useProgram(prog.p);
  g.uniform2f(prog.uRes,E.W,E.H);g.uniform1f(prog.uTime,st.t);
  let fade=1;{const ph=st.t%18.0;if(ph<1.5)fade=E.smoothstep(0,1.5,ph);else if(ph>=16.0)fade=1-E.smoothstep(16.0,18.0,ph);}g.uniform1f(prog.uFade,fade);
  E.drawTri();},
 drawParticles(){},
 countParticles(){return 0;}
});
})();
(function(){
"use strict";
const A=window.__ARC,E=A.env;
const FS=[
'#version 300 es',
'precision highp float;',
'uniform vec2 uRes,uC;uniform float uTime,uSlash,uHold,uExp,uShrink,uSep;',
'uniform float uST[5];',
'out vec4 o;',
E.NOISE,
'void main(){',
' float mn=min(uRes.x,uRes.y);',
' vec2 uv=(gl_FragCoord.xy-uC)/mn;',
' vec3 col=vec3(.018,.004,.01);',
' float nb=fbm2(uv*2.4+vec2(0.,uTime*.02));',
' col+=vec3(.10,.012,.028)*nb*nb;',
' vec3 ro=vec3(0.,0.,-2.6);',
' vec3 rd=normalize(vec3(uv,1.6));',
' float R=0.72*uShrink;',
' float tr=1.;vec3 acc=vec3(0.);',
' if(R>0.02){',
'  float b=dot(ro,rd),c2=dot(ro,ro)-R*R*2.1;',
'  float h=b*b-c2;',
'  if(h>0.){',
'   h=sqrt(h);',
'   float t=max(-b-h,0.),t1=-b+h;',
'   float dtS=(t1-t)/36.;',
'   for(int i=0;i<36;i++){',
'    vec3 p=ro+rd*t;',
'    vec3 ps=p;',
'    float seam=0.;float cut=1.;float spill=0.;',
'    for(int k=0;k<5;k++){',
'     float act=clamp(uSlash-float(k),0.,1.);',
'     if(act>0.){',
'      float fk=float(k);',
'      vec3 nrm=normalize(vec3(cos(fk*2.4+.8),sin(fk*1.9+.3),sin(fk*1.3+.5)*.7));',
'      float sd=dot(ps,nrm);',
'      ps-=nrm*sign(sd)*uSep*act;',
'      float ad=abs(dot(p,nrm));',
'      float w=.02+.03*uExp;',
'      cut*=mix(1.,smoothstep(w*.5,w*1.3,ad),act);',
'      seam+=act*exp(-pow(ad/(w*2.2),2.));',
'      spill+=act*(1.-smoothstep(0.,.09,ad));',
'     }',
'    }',
'    float r=length(ps);',
'    float n=fbm3(ps*3.0+vec3(0.,0.,uTime*.22));',
'    float shell=smoothstep(R*.5,R*.9,r)*(1.-smoothstep(R*.95,R*1.08,r));',
'    shell*=.45+1.1*n;',
'    float core=(1.-smoothstep(R*.1,R*.42,r))*(.55+.85*fbm3(ps*4.5+vec3(uTime*.5)));',
'    vec3 em=vec3(.95,.07,.05)*shell*1.5+vec3(.22,.75,1.35)*core*2.8;',
'    float inside=1.-smoothstep(R*.95,R*1.05,r);',
'    em+=vec3(1.2,1.6,2.2)*seam*inside*(1.6+4.*uHold);',
'    em+=vec3(.3,.9,1.5)*spill*inside*(1.-r/max(R,1e-3))*2.2;',
'    float dens=((shell*2.1+core*2.6)*cut+seam*2.5*inside)*(1.-uExp);',
'    float a=1.-exp(-dens*dtS*3.8);',
'    acc+=em*a*tr;tr*=1.-a;',
'    if(tr<0.02)break;',
'    t+=dtS;',
'   }',
'  }',
' }',
' col=col*tr+acc;',
' for(int k=0;k<5;k++){',
'  float st=uST[k];',
'  if(st>=0.){',
'   float fk=float(k);',
'   float ang=fk*2.4+.8;',
'   vec2 dir=vec2(cos(ang),sin(ang));',
'   vec2 nv=vec2(-dir.y,dir.x);',
'   float dL=dot(uv,nv);',
'   float s=dot(uv,dir);',
'   float sweep=clamp(st/.06,0.,1.);',
'   float head=mix(-1.15,1.15,sweep);',
'   float drawn=1.-smoothstep(head,head+.1,s);',
'   float taper=1.-smoothstep(.85,1.2,abs(s));',
'   float fade=exp(-st*5.5);',
'   float wC=.006+.025*st;',
'   float core2=exp(-dL*dL/(wC*wC))*drawn*taper;',
'   float halo=exp(-dL*dL/(wC*wC*40.))*drawn*taper*.3;',
'   vec2 tp=uv-dir*head;',
'   float tip=exp(-dot(tp,tp)*700.)*(1.2-sweep);',
'   col+=(vec3(1.25,1.5,2.05)*core2+vec3(.5,.75,1.6)*halo)*fade*1.9;',
'   col+=vec3(1.7,1.85,2.2)*tip*fade;',
'  }',
' }',
' if(uExp>0.001){',
'  float d=length(uv);',
'  float rw=uExp*1.5;',
'  float k1=exp(-pow((d-rw)*8.,2.))*(1.-uExp);',
'  float k2=exp(-pow((d-rw*.68)*13.,2.))*(1.-uExp);',
'  col+=vec3(1.4,.22,.15)*k1*2.1+vec3(.35,.75,1.3)*k2*1.4;',
'  col+=vec3(1.,.45,.35)*exp(-d*4.5)*(1.-uExp)*(1.-uExp)*2.2;',
' }',
' o=vec4(col,1.);',
'}'
].join('\n');
const glow=new E.Pool(2048);
const smoke=new E.Pool(320);
let prog=null;
const st={phase:0,timer:0,slash:0,uSlash:0,hold:0,exp:0,shrink:0,sep:0};
const sAge=new Float32Array(5);
function boom(){
 E.flashAdd(1,1,.55,.4);E.shakeAdd(26*E.SC);E.setCA(0.011);
 const cx=E.W*0.5,cy=E.H*0.5,SC=E.SC;
 for(let i=0;i<320;i++){
  const a=Math.random()*E.TAU;
  const sp=E.rnd(240,980)*SC;
  const hot=Math.random()<0.55;
  glow.spawn(cx+E.rnd(-30,30)*SC,cy+E.rnd(-30,30)*SC,
   Math.cos(a)*sp,Math.sin(a)*sp,
   E.rnd(1.1,2.2),E.rnd(10,42)*SC,
   hot?E.rnd(.9,1.3):E.rnd(.4,.6),hot?E.rnd(.12,.3):.05,hot?.06:.04,
   E.rnd(.6,.95),2,{rot:Math.random()*E.TAU,rv:E.rnd(-3,3),drag:1.4,grav:-380*SC});
 }
 for(let i=0;i<150;i++){
  const a=Math.random()*E.TAU;
  const sp=E.rnd(500,1500)*SC;
  glow.spawn(cx,cy,Math.cos(a)*sp,Math.sin(a)*sp,
   E.rnd(.3,.7),E.rnd(4,12)*SC,.5,.9,1.4,.9,0,{drag:2.2});
 }
 for(let i=0;i<60;i++){
  const a=Math.random()*E.TAU;
  const sp=E.rnd(60,260)*SC;
  smoke.spawn(cx,cy,Math.cos(a)*sp,Math.sin(a)*sp,
   E.rnd(1.6,2.8),E.rnd(70,180)*SC,.10,.03,.04,E.rnd(.3,.5),3,
   {drag:.8,grav:55*SC,rot:Math.random()*E.TAU,rv:E.rnd(-.5,.5)});
 }
}
function slashSpark(k){
 const cx=E.W*0.5,cy=E.H*0.5,SC=E.SC;
 const ang=k*2.4+.8;
 const dx=Math.cos(ang),dy=Math.sin(ang);
 const R=0.36*Math.min(E.W,E.H);
 for(let i=0;i<22;i++){
  const u=E.rnd(-R,R);
  glow.spawn(cx+dx*u,cy+dy*u,
   -dy*E.rnd(-160,160)*SC,dx*E.rnd(-160,160)*SC,
   E.rnd(.15,.4),E.rnd(3,9)*SC,.8,.95,1.5,.9,0,{drag:3});
 }
}
A.reg({
 id:'FX-88',name:'진홍 핵 절단',en:'Crimson Core Severance',
 desc:'화면 전폭 애니메 참격 섬광이 구체를 5연속 작도 — 절단면이 카빙되어 청색 내핵광이 균열로 누출, 파편이 물리 분리된 채 정지 후 폭발.',
 tech:['Screen-wide Slash Sweep','Density Carving + Core Spill','Fragment Separation SDF','Tip Glint + Afterimage','FBO Bloom+CA'],
 bloom:1.0,
 init(){
  prog=E.U(E.mkProg(E.FS_VERT,FS,'FX88'),['uRes','uC','uTime','uSlash','uHold','uExp','uShrink','uSep','uST']);
 },
 reset(){
  glow.clear();smoke.clear();
  st.phase=0;st.timer=0;st.slash=0;st.uSlash=0;st.hold=0;st.exp=0;st.shrink=0;st.sep=0;
  sAge.fill(-1);
 },
 autoPoint(){return [E.W*0.5,E.H*0.5];},
 trigger(){
  if(st.phase!==0||st.shrink<0.95)return;
  st.phase=1;st.timer=0;st.slash=0;
 },
 update(dt,t){
  st.timer+=dt;
  for(let k=0;k<5;k++)if(sAge[k]>=0)sAge[k]+=dt;
  if(st.phase===0){
   st.shrink=Math.min(1,st.shrink+dt*1.4);
  }else if(st.phase===1){
   const k=st.timer/0.12;
   if(st.slash<5&&k>=st.slash+1){
    st.slash++;sAge[st.slash-1]=0;E.flashAdd(0.3,.7,.85,1);E.shakeAdd(9*E.SC);
    slashSpark(st.slash-1);
   }
   st.uSlash=Math.min(5,k);
   if(k>=5.5){st.phase=2;st.timer=0;st.hold=1;}
  }else if(st.phase===2){
   E.shakeAdd(2.6*E.SC);
   st.sep=Math.min(0.055,st.sep+dt*0.16);
   if(st.timer>0.45){st.phase=3;st.timer=0;st.hold=0;boom();}
  }else if(st.phase===3){
   const u=Math.min(1,st.timer/1.15);
   st.exp=E.easeOutCubic(u);
   st.shrink=Math.max(0,1-st.timer/0.22);
   if(st.timer>2.1){st.phase=4;st.timer=0;st.uSlash=0;st.exp=0;st.sep=0;sAge.fill(-1);}
  }else{
   if(st.timer>0.6){
    st.shrink=Math.min(1,st.shrink+dt*1.1);
    if(st.shrink>=1)st.phase=0;
   }
  }
  glow.update(dt,t,null);
  smoke.update(dt,t,null);
 },
 drawField(t){
  if(!prog||!prog.p)return;
  const g=E.gl;
  g.useProgram(prog.p);
  g.uniform2f(prog.uRes,E.W,E.H);
  g.uniform2f(prog.uC,E.W*0.5,E.H*0.5);
  g.uniform1f(prog.uTime,t);
  g.uniform1f(prog.uSlash,st.uSlash);
  g.uniform1f(prog.uHold,st.hold);
  g.uniform1f(prog.uExp,st.exp);
  g.uniform1f(prog.uShrink,st.shrink);
  g.uniform1f(prog.uSep,st.sep);
  g.uniform1fv(prog.uST,sAge);
  E.drawTri();
 },
 drawParticles(){
  E.drawPool(glow,E.ADD());
  E.drawPool(smoke,E.ALPHA());
 },
 countParticles(){return glow.n+smoke.n;}
});
})();
(function(){
"use strict";
const A=window.__ARC,E=A.env;
const FS=[
'#version 300 es',
'precision highp float;',
'uniform vec2 uRes;uniform float uTime,uGround;',
'out vec4 o;',
E.NOISE,
'void main(){',
' float mn=min(uRes.x,uRes.y);',
' vec2 uv=(gl_FragCoord.xy-uRes*.5)/mn;',
' vec3 col=mix(vec3(.014,.018,.038),vec3(.004,.005,.012),clamp(uv.y+.5,0.,1.));',
' float s=n2(uv*60.+vec2(3.7,9.1));',
' col+=vec3(.5,.6,.8)*smoothstep(.965,1.,s)*(.4+.6*n2(uv*9.+vec2(uTime*.7,0.)));',
' float nb=fbm2(uv*2.2+vec2(uTime*.02,0.));',
' col+=vec3(.045,.05,.095)*nb*nb;',
' float gy=-.34;',
' float g=exp(-pow((uv.y-gy)*9.,2.));',
' col+=vec3(1.,.45,.15)*g*uGround*.95;',
' col+=vec3(.5,.2,.08)*uGround*exp(-abs(uv.y-gy)*5.)*.35;',
' float rough=fbm2(vec2(uv.x*6.,gy*4.));',
' col+=vec3(.8,.3,.1)*uGround*g*rough*.6;',
' o=vec4(col,1.);',
'}'
].join('\n');
const MM=96;
const mx=new Float32Array(MM),my=new Float32Array(MM),
      mvx=new Float32Array(MM),mvy=new Float32Array(MM),
      msz=new Float32Array(MM),mact=new Uint8Array(MM);
const trail=new E.Pool(2048);
const spark=new E.Pool(1536);
const smoke=new E.Pool(256);
let prog=null;
const st={phase:0,timer:0,acc:0,ground:0};
function floorY(){return E.H*0.5-0.34*Math.min(E.W,E.H);}
function impact(i){
 mact[i]=0;
 const fy=floorY();
 E.flashAdd(0.16,1,.6,.3);E.shakeAdd(3.5*E.SC);
 st.ground=Math.min(1.4,st.ground+0.15);
 for(let k=0;k<26;k++){
  spark.spawn(mx[i]+E.rnd(-8,8)*E.SC,fy+E.rnd(0,10)*E.SC,
   E.rnd(-520,520)*E.SC,E.rnd(220,950)*E.SC,
   E.rnd(.4,.9),E.rnd(2.5,8)*E.SC,1.4,.75,.28,E.rnd(.6,.95),0,
   {drag:.6,grav:-1750*E.SC});
 }
 for(let k=0;k<3;k++){
  smoke.spawn(mx[i],fy,E.rnd(-60,60)*E.SC,E.rnd(40,140)*E.SC,
   E.rnd(1.2,2.2),E.rnd(50,120)*E.SC,.12,.06,.05,E.rnd(.25,.4),3,
   {drag:.8,rot:Math.random()*E.TAU,rv:E.rnd(-.5,.5)});
 }
}
A.reg({
 id:'FX-99',name:'유성우 탄막',en:'Meteor Shower Barrage',
 desc:'하늘이 찢기며 고속 유성 탄막이 광역 낙하. 사선 화염 궤적 + 착탄 스파크 분수 + 지표 열 축적 발광. 유성 96슬롯 고정 재활용.',
 tech:['96-slot Meteor Recycle','Diagonal Streak Trails','Impact Spark Fountains','Ground Heat Accumulation','Delta-time Spawn Rate'],
 bloom:1.0,
 init(){
  prog=E.U(E.mkProg(E.FS_VERT,FS,'FX99'),['uRes','uTime','uGround']);
 },
 reset(){
  trail.clear();spark.clear();smoke.clear();
  mact.fill(0);
  st.phase=0;st.timer=0;st.acc=0;st.ground=0;
 },
 autoPoint(){return [E.W*0.5,E.H*0.5];},
 trigger(){
  st.phase=1;st.timer=0;
 },
 update(dt,t){
  st.timer+=dt;
  st.ground*=Math.exp(-1.0*dt);
  if(st.phase===1){
   const rate=E.lerp(8,24,Math.min(1,st.timer/1.2));
   st.acc+=rate*dt;
   while(st.acc>1){
    st.acc--;
    let slot=-1;
    for(let i=0;i<MM;i++)if(!mact[i]){slot=i;break;}
    if(slot<0)break;
    const side=Math.random()<0.5?-1:1;
    mact[slot]=1;
    mvx[slot]=side*E.rnd(480,1000)*E.SC;
    mvy[slot]=-E.rnd(1500,2300)*E.SC;
    mx[slot]=E.rnd(-0.15,1.15)*E.W-mvx[slot]*0.25;
    my[slot]=E.H+30*E.SC;
    msz[slot]=E.rnd(8,17)*E.SC;
   }
   if(st.timer>3.4)st.phase=0;
  }
  const fy=floorY();
  for(let i=0;i<MM;i++){
   if(!mact[i])continue;
   mx[i]+=mvx[i]*dt;my[i]+=mvy[i]*dt;
   if(my[i]<=fy){impact(i);continue;}
   const nT=Math.max(1,Math.round(dt*110));
   for(let k=0;k<nT;k++){
    trail.spawn(mx[i]+E.rnd(-4,4)*E.SC,my[i]+E.rnd(-4,4)*E.SC,
     mvx[i]*0.1+E.rnd(-25,25),mvy[i]*0.1+E.rnd(-25,25),
     E.rnd(.22,.45),E.rnd(5,16)*E.SC,1.35,.7,.25,E.rnd(.5,.9),0,
     {drag:2.4});
   }
   trail.spawn(mx[i],my[i],0,0,0.06,msz[i]*2.2,1.5,1.1,.7,1,0,{});
  }
  trail.update(dt,t,null);
  spark.update(dt,t,null);
  smoke.update(dt,t,null);
 },
 drawField(t){
  if(!prog||!prog.p)return;
  const g=E.gl;
  g.useProgram(prog.p);
  g.uniform2f(prog.uRes,E.W,E.H);
  g.uniform1f(prog.uTime,t);
  g.uniform1f(prog.uGround,st.ground);
  E.drawTri();
 },
 drawParticles(){
  E.drawPool(trail,E.ADD());
  E.drawPool(spark,E.ADD());
  E.drawPool(smoke,E.ALPHA());
 },
 countParticles(){
  let m=0;for(let i=0;i<MM;i++)m+=mact[i];
  return trail.n+spark.n+smoke.n+m;
 }
});
})();
(function(){
"use strict";
const A=window.__ARC,E=A.env;
const FS=[
'#version 300 es',
'precision highp float;',
'uniform vec2 uRes;uniform float uTime,uGate,uGateA,uPulse;',
'uniform float uPil[6];',
'out vec4 o;',
E.NOISE,
'float sdBox(vec3 q,vec3 b){vec3 dd=abs(q)-b;return length(max(dd,vec3(0.)))+min(max(dd.x,max(dd.y,dd.z)),0.);}',
'float mapP(vec3 p){',
' float d=1e3;',
' for(int i=0;i<6;i++){',
'  float fi=float(i);',
'  float a=fi*1.0472+.52;',
'  vec2 c=vec2(cos(a),sin(a))*.62;',
'  float yo=-1.78+uPil[i]*1.48;',
'  vec3 q=p-vec3(c.x,yo,c.y);',
'  float ya=fi*.9;',
'  float cy2=cos(ya),sy2=sin(ya);',
'  q.xz=mat2(cy2,-sy2,sy2,cy2)*q.xz;',
'  d=min(d,sdBox(q,vec3(.115,.70,.115))-.012);',
' }',
' return d;',
'}',
'void main(){',
' vec2 uv=(gl_FragCoord.xy-uRes*.5)/uRes.y;',
' vec3 ro=vec3(0.,0.5,-3.2);',
' vec3 rd=normalize(vec3(uv,1.7));',
' float cp=0.96891,sp=0.24740;',
' rd=vec3(rd.x,cp*rd.y-sp*rd.z,sp*rd.y+cp*rd.z);',
' vec3 col=mix(vec3(.022,.012,.008),vec3(.006,.003,.004),clamp(uv.y+.55,0.,1.));',
' float nb=fbm2(uv*2.1+vec2(0.,uTime*.015));',
' col+=vec3(.07,.03,.012)*nb*nb;',
' float mote=n2(uv*36.+vec2(uTime*.15,uTime*.45));',
' col+=vec3(.8,.5,.15)*smoothstep(.95,1.,mote)*.3*uGateA;',
' float tr=1.;vec3 acc=vec3(0.);',
' if(uGate>0.02){',
'  vec3 cc=vec3(0.,-.45,0.);',
'  vec3 oc=ro-cc;',
'  float b=dot(oc,rd),c2=dot(oc,oc)-2.6;',
'  float h=b*b-c2;',
'  if(h>0.){',
'   h=sqrt(h);',
'   float t=max(-b-h,0.),t1=-b+h;',
'   float dtS=(t1-t)/40.;',
'   for(int i=0;i<40;i++){',
'    if(t>t1)break;',
'    vec3 p=ro+rd*t;',
'    float d=mapP(p);',
'    if(d>0.06){t+=max(dtS,d*0.7);continue;}',
'    float clipF=smoothstep(-1.02,-0.99,p.y);',
'    float inside=(1.-smoothstep(-0.02,0.025,d))*clipF;',
'    if(inside>0.002){',
'     float stone=.55+.45*fbm3(p*6.);',
'     vec3 em=vec3(.07,.06,.065)*stone;',
'     float ug=exp(-(p.y+1.0)*2.4)*uGateA;',
'     em+=vec3(.9,.6,.2)*ug*.5;',
'     float gy=p.y*6.5;',
'     float rowm=smoothstep(.12,.2,fract(gy))*(1.-smoothstep(.8,.88,fract(gy)));',
'     float g=smoothstep(.52,.62,n2(vec2((p.x*2.7+p.z*3.3)*3.1,floor(gy)*7.3+(p.x-p.z)*5.)));',
'     float pls=1.1+.8*sin(uTime*2.6+p.y*2.+(p.x+p.z)*1.5);',
'     em+=vec3(1.5,.5,.1)*g*rowm*pls*uPulse;',
'     float rim=(1.-smoothstep(0.,0.03,abs(d)))*clipF;',
'     em+=vec3(1.1,.78,.3)*rim*(.35+.85*ug);',
'     float dens=inside*4.2+rim*1.4;',
'     float a2=1.-exp(-dens*dtS*4.);',
'     acc+=em*a2*tr;tr*=1.-a2;',
'     if(tr<0.03)break;',
'    }',
'    t+=dtS;',
'   }',
'  }',
' }',
' if(rd.y<-0.02&&uGate>0.001&&tr>0.02){',
'  float tf=(-1.0-ro.y)/rd.y;',
'  vec3 fp=ro+rd*tf;',
'  vec2 xz=fp.xz;',
'  float dd=length(xz);',
'  if(dd<3.){',
'   float G=uGate;',
'   float spin=uTime*1.1;',
'   float cs=cos(spin),ss=sin(spin);',
'   vec2 rp=mat2(cs,-ss,ss,cs)*xz;',
'   float aa=.022;',
'   float Rb=G*.46;',
'   float inBig=1.-smoothstep(max(Rb-aa,0.),Rb+aa,dd);',
'   float l1=length(rp-vec2(0.,Rb*.5));',
'   float l2=length(rp+vec2(0.,Rb*.5));',
'   float v=smoothstep(-aa,aa,rp.x);',
'   v=mix(v,1.,1.-smoothstep(max(Rb*.5-aa,0.),Rb*.5+aa,l1));',
'   v=mix(v,0.,1.-smoothstep(max(Rb*.5-aa,0.),Rb*.5+aa,l2));',
'   v=mix(v,0.,1.-smoothstep(max(Rb*.16-aa,0.),Rb*.16+aa,l1));',
'   v=mix(v,1.,1.-smoothstep(max(Rb*.16-aa,0.),Rb*.16+aa,l2));',
'   float fog=exp(-tf*.2);',
'   vec3 e=vec3(0.);',
'   e+=vec3(1.05,1.,.9)*v*inBig*(.5+.4*uPulse);',
'   e-=vec3(.02,.012,.01)*(1.-v)*inBig*2.;',
'   float r1=exp(-pow((dd-G*.62)*90.,2.));',
'   float r2=exp(-pow((dd-G*.85)*90.,2.));',
'   float r3=exp(-pow((dd-G*1.02)*70.,2.));',
'   e+=vec3(1.3,.92,.28)*(r1+r2*.8+r3)*1.1;',
'   vec2 nd=xz/max(dd,1e-4);',
'   float db=smoothstep(.5,.72,n2(nd*2.6+vec2(spin*.5,0.)));',
'   float bandm=exp(-pow((dd-G*.93)*42.,2.));',
'   e+=vec3(1.25,.85,.25)*db*bandm*1.2;',
'   float halo=exp(-pow((dd-G*1.02)*8.,2.));',
'   e+=vec3(.5,.32,.1)*halo*.5;',
'   acc+=max(e,vec3(-.06))*fog*tr*uGateA;',
'  }',
' }',
' col=col*tr+acc;',
' o=vec4(col,1.);',
'}'
].join('\n');
const ember=new E.Pool(1024);
const smoke=new E.Pool(384);
let prog=null;
const st={phase:0,timer:0,gate:0,gateA:0,pulse:0,acc:0};
const pil=new Float32Array(6);
const locked=new Uint8Array(6);
function projXZ(wx,wz){
 const cp=0.96891,sp=0.24740;
 const dx=wx-0,dy=-1.0-0.5,dz=wz+3.2;
 const yc=cp*dy+sp*dz,zc=-sp*dy+cp*dz;
 return [E.W*0.5+(dx/zc)*1.7*E.H,E.H*0.5+(yc/zc)*1.7*E.H];
}
function lockBurst(i){
 const a=i*1.0472+0.52;
 const s=projXZ(Math.cos(a)*0.62,Math.sin(a)*0.62);
 E.shakeAdd(10*E.SC);E.flashAdd(0.22,1,.75,.35);
 for(let k=0;k<26;k++){
  ember.spawn(s[0]+E.rnd(-18,18)*E.SC,s[1]+E.rnd(-4,8)*E.SC,
   E.rnd(-360,360)*E.SC,E.rnd(120,620)*E.SC,
   E.rnd(.4,.9),E.rnd(2.5,8)*E.SC,1.35,.7,.2,E.rnd(.6,.95),0,
   {drag:.9,grav:-1500*E.SC});
 }
 for(let k=0;k<4;k++){
  smoke.spawn(s[0],s[1],E.rnd(-90,90)*E.SC,E.rnd(30,120)*E.SC,
   E.rnd(1,1.8),E.rnd(40,95)*E.SC,.1,.07,.05,E.rnd(.25,.4),3,
   {drag:.9,rot:Math.random()*E.TAU,rv:E.rnd(-.5,.5)});
 }
}
A.reg({
 id:'FX-110',name:'음양 부적 관문',en:'Yin-Yang Talisman Gate',
 desc:'흑백 음양 인장이 회전 전개되고 황금 결계환 3중이 잠긴다. 룬각 석주 6기가 시차 융기·고정, 작열 주문이 열맥동. 잠금마다 분진 폭발.',
 tech:['SDF Yin-Yang Sigil','6-Pillar Box March','Carved Rune Emission','Staggered Thrust Lock','Underglow Gold Light'],
 bloom:0.95,
 init(){
  prog=E.U(E.mkProg(E.FS_VERT,FS,'FX110'),['uRes','uTime','uGate','uGateA','uPulse','uPil']);
 },
 reset(){
  ember.clear();smoke.clear();
  st.phase=0;st.timer=0;st.gate=0;st.gateA=0;st.pulse=0;st.acc=0;
  pil.fill(0);locked.fill(0);
 },
 autoPoint(){return [E.W*0.5,E.H*0.5];},
 trigger(){
  if(st.phase!==0)return;
  st.phase=1;st.timer=0;locked.fill(0);
  E.flashAdd(0.4,1,.85,.5);E.shakeAdd(8*E.SC);
 },
 update(dt,t){
  st.timer+=dt;
  if(st.phase===0){
   st.gate=Math.max(0,st.gate-dt*1.6);
   st.gateA=Math.max(0,st.gateA-dt*1.6);
   st.pulse=Math.max(0,st.pulse-dt*2);
   pil.fill(Math.max(0,pil[0]-dt*2));
  }else if(st.phase===1){
   st.gate=E.easeOutCubic(Math.min(1,st.timer/0.45))*0.95;
   st.gateA=Math.min(1,st.timer/0.3);
   st.pulse=Math.min(1,st.timer/0.5);
   for(let i=0;i<6;i++){
    const u=E.clamp((st.timer-0.25-i*0.07)/0.38,0,1);
    pil[i]=u<1?(u>0?E.easeOutBack(u):0):1;
    if(u>=0.85&&!locked[i]){locked[i]=1;lockBurst(i);}
   }
   if(st.timer>0.25+5*0.07+0.5){st.phase=2;st.timer=0;}
  }else if(st.phase===2){
   st.pulse=1+0.25*Math.sin(t*5.2);
   st.acc+=dt*22;
   while(st.acc>1){
    st.acc--;
    const a=Math.random()*E.TAU,r=E.rnd(.1,.55);
    const s=projXZ(Math.cos(a)*r,Math.sin(a)*r);
    ember.spawn(s[0],s[1],E.rnd(-15,15),E.rnd(60,170)*E.SC,
     E.rnd(1.2,2.4),E.rnd(2,5.5)*E.SC,1.2,.85,.3,E.rnd(.3,.6),0,{drag:.4});
   }
   if(st.timer>3.4){st.phase=3;st.timer=0;}
  }else{
   const u=Math.min(1,st.timer/0.7);
   for(let i=0;i<6;i++)pil[i]=1-E.easeOutCubic(u);
   st.gateA=1-u;
   st.pulse=1-u;
   if(u>=1){st.phase=0;st.gate=0;}
  }
  ember.update(dt,t,null);
  smoke.update(dt,t,null);
 },
 drawField(t){
  if(!prog||!prog.p)return;
  const g=E.gl;
  g.useProgram(prog.p);
  g.uniform2f(prog.uRes,E.W,E.H);
  g.uniform1f(prog.uTime,t);
  g.uniform1f(prog.uGate,st.gate);
  g.uniform1f(prog.uGateA,st.gateA);
  g.uniform1f(prog.uPulse,st.pulse);
  g.uniform1fv(prog.uPil,pil);
  E.drawTri();
 },
 drawParticles(){
  E.drawPool(ember,E.ADD());
  E.drawPool(smoke,E.ALPHA());
 },
 countParticles(){return ember.n+smoke.n;}
});
})();
(function(){
"use strict";
const A=window.__ARC,E=A.env;
const FS=[
'#version 300 es','precision highp float;',
'uniform vec2 uRes;uniform float uTime,uWhite,uBlack,uGrow,uCloudA,uShock,uAge2,uFlash;',
'out vec4 o;',E.NOISE,
'float den(vec3 p,float g,float n,out float hot){',
' hot=0.;',
' float top=-1.+1.62*g;',
' float hcol=clamp((p.y+1.)/(top+1.+1e-3),0.,1.);',
' float taper=mix(1.5,0.8,hcol);',
' float stemR=max((.085+.05*g)*taper*(.62+.55*n),1e-3);',
' float ys=smoothstep(-1.02,-.9,p.y)*(1.-smoothstep(top-.2,top+.06,p.y));',
' float swirl=fbm3(vec3(p.x*3.+sin(p.y*4.+uTime*.6)*.4,p.y*2.2-uTime*.5,p.z*3.));',
' float stem=(1.-smoothstep(stemR*.45,stemR,length(p.xz)))*ys*(.55+.7*swirl);',
' vec3 pc=p-vec3(0.,top,0.);',
' float capR=(.18+.64*g);',
' vec2 tr=vec2(length(p.xz)-capR*.70,pc.y*1.2);',
' float torus=length(tr)-capR*.42*(.6+.62*n);',
' float roll=1.-smoothstep(-.05,.08,torus);',
' vec3 pd=pc;pd.y*=(pc.y>0.)?1.05:2.4;',
' float dome=length(pd)-capR*(.70+.5*n);',
' float cap=1.-smoothstep(-.04,.08,dome);',
' float scoop=1.-smoothstep(0.,capR*.5,length(vec2(length(p.xz),(pc.y+capR*.18)*1.25)));',
' float canopy=max(cap,roll)*(1.-scoop*.55*(1.-smoothstep(-.25,.02,pc.y)));',
' float capLip=roll*(1.-smoothstep(.0,.12,abs(pc.y)));',
' hot=exp(-dot(p.xz,p.xz)*2.6)*exp(-max(p.y+.7,0.)*2.2)*ys;',
' hot+=capLip*.25;',
' return clamp(canopy*1.08+stem*.92,0.,1.4);',
'}',
'void main(){',
' if(uBlack>0.5){o=vec4(0.,0.,0.,1.);return;}',
' if(uWhite>0.5){o=vec4(1.6,1.6,1.55,1.);return;}',
' vec2 uv=(gl_FragCoord.xy-uRes*.5)/uRes.y;',
/* ground-anchored oblique flattened ellipse for the shock */
' vec2 gp=uv-vec2(0.,-0.32);',
' vec2 es=gp*vec2(1.0,2.8);es.y+=gp.x*0.10;',
' float ed=length(es);',
' vec3 ro=vec3(0.,0.5,-3.4);',
' vec3 rd=normalize(vec3(uv,1.7));',
' float cp=0.96891,sp2=0.24740;',
' rd=vec3(rd.x,cp*rd.y-sp2*rd.z,sp2*rd.y+cp*rd.z);',
' float d0=length(uv);',
' vec2 bp=uv;',
' if(uShock>0.001&&uShock<1.){',
'  vec2 nd=gp/max(length(gp),1e-4);',
'  float dsh=sin((ed-uShock*1.15)*30.)*exp(-abs(ed-uShock*1.15)*8.)*.045*(1.-uShock);',
'  bp+=nd*dsh;',
' }',
' vec3 col=mix(vec3(.014,.013,.03),vec3(.004,.004,.011),clamp(bp.y+.5,0.,1.));',
' float cl=fbm2(bp*1.8+vec2(uTime*.01,0.));',
' col+=vec3(.05,.04,.07)*cl*cl*clamp(.6-bp.y,0.,1.);',
' float hz=exp(-pow((bp.y+.30)*9.,2.));',
' col+=vec3(.18,.09,.05)*hz*(.4+2.4*clamp(uGrow*1.5,0.,1.)*uCloudA);',
/* wide horizontal base-surge skirt hugging the ground */
' float skirt=exp(-pow((bp.y+.34)*15.,2.))*exp(-pow((abs(bp.x)-uShock*1.0)*4.,2.));',
' col+=vec3(.34,.38,.46)*skirt*uCloudA*clamp(uGrow*2.,0.,1.)*.7;',
' float str=n2(bp*70.+vec2(7.3,2.1));',
' col+=vec3(.4,.45,.6)*smoothstep(.975,1.,str)*.5*(1.-uGrow);',
' float tr=1.;vec3 acc=vec3(0.);',
' if(uGrow>0.01&&uCloudA>0.01){',
'  float g=uGrow;',
'  float top=-1.+1.62*g+.9*g;',
'  vec3 bc=vec3(0.,(-1.+top)*.5,0.);',
'  float bR=(top+1.)*.62+.5;',
'  vec3 oc=ro-bc;',
'  float b=dot(oc,rd),c2=dot(oc,oc)-bR*bR;',
'  float h=b*b-c2;',
'  if(h>0.){',
'   h=sqrt(h);',
'   float t=max(-b-h,0.),t1=-b+h;',
'   float dtS=(t1-t)/48.;',
'   for(int i=0;i<48;i++){',
'    if(t>t1)break;',
'    vec3 p=ro+rd*t;',
'    float n=fbm3(p*2.4+vec3(0.,-uTime*.18,uTime*.04));',
'    float hot;float dn2=den(p,g,n,hot);',
'    if(dn2>0.02){',
'     float hN=clamp((p.y+1.)/1.9,0.,1.);',
'     float fire=clamp(1.5-uAge2*1.0,0.,1.5);',
'     float core=hot*fire;',
'     vec3 fcol=mix(vec3(1.7,.72,.2),vec3(1.2,.24,.06),hN);',
'     vec3 ash=mix(vec3(.22,.19,.18),vec3(.42,.36,.32),n)*(.5+.5*n);',
'     vec3 underlit=vec3(1.4,.6,.22)*pow(1.-hN,2.)*fire*.6;',
'     vec3 em=mix(ash,fcol*1.5,clamp(core*1.4,0.,1.))+underlit;',
'     em+=vec3(1.7,1.1,.5)*core*1.3;em*=.55+.5*n;',
'     float dmul=mix(1.,1.7,smoothstep(.4,.9,hN));',
'     float a2=1.-exp(-dn2*dtS*5.*dmul*uCloudA);',
'     acc+=em*a2*tr;tr*=1.-a2;if(tr<0.03)break;t+=dtS;',
'    }else{t+=dtS*1.8;}',
'   }',
'  }',
' }',
' col=col*tr+acc;',
/* horizontal elliptical shock ring + secondary ground ring */
' if(uShock>0.001&&uShock<1.){',
'  col+=vec3(1.25,.92,.6)*exp(-pow((ed-uShock*1.15)*12.,2.))*(1.-uShock)*1.8;',
'  col+=vec3(.55,.5,.55)*exp(-pow((ed-uShock*0.78)*7.,2.))*(1.-uShock)*0.6;',
' }',
/* detonation fireball flash (initial bloom) */
' col+=vec3(1.6,1.2,.7)*exp(-pow((d0-0.0)*3.5,2.))*uFlash*2.2;',
' col+=vec3(1.5,.85,.42)*exp(-d0*2.4)*clamp(uGrow*2.5,0.,1.)*clamp(1.-uAge2*1.3,0.,1.)*uCloudA;',
' o=vec4(col,1.);',
'}'
].join('\n');
const dustw=new E.Pool(700),ember=new E.Pool(512);
let prog=null;
const st={phase:0,timer:0,white:0,black:0,grow:0,cloudA:1,shock:0,age2:0,flash:0,acc:0};
A.reg({
 id:'FX-130',name:'침묵의 핵폭 · 버섯구름',en:'Silent Detonation & Mushroom Cloud',
 desc:'1프레임 백광 → 1초 암흑(정적·히트스톱) → 화구 플래시 블룸과 함께 레이마칭 버섯구름 ease-out 팽창. 충격파를 가로로 납작한 비스듬 타원(지면 밀착)으로 전파 + 2차 베이스서지 링, 좌표 굴절도 타원 법선 방향. 말려오르는 토러스 캡·화구 백열·언더라이트, 재색 냉각.',
 tech:['Oblique-Elliptical Ground Shock','Base-Surge Skirt','Fireball Flash Bloom','Toroidal Rollover Cap','Adaptive 48-step March'],
 bloom:1.12,
 init(){prog=E.U(E.mkProg(E.FS_VERT,FS,'FX130'),['uRes','uTime','uWhite','uBlack','uGrow','uCloudA','uShock','uAge2','uFlash']);},
 reset(){dustw.clear();ember.clear();st.phase=0;st.timer=0;st.white=0;st.black=0;st.grow=0;st.cloudA=1;st.shock=0;st.age2=0;st.flash=0;st.acc=0;},
 autoPoint(){return [E.W*0.5,E.H*0.5];},
 resize(){},
 trigger(){if(st.phase!==0)return;st.phase=1;st.timer=0;st.white=1;dustw.clear();ember.clear();},
 update(dt,t){
  st.timer+=dt;st.flash=Math.max(0,st.flash-dt*2.2);
  if(st.phase===0){st.grow=Math.max(0,st.grow-dt);st.cloudA=1;}
  else if(st.phase===1){if(st.timer>0.07){st.phase=2;st.timer=0;st.white=0;st.black=1;}}
  else if(st.phase===2){if(st.timer>=1.0){st.phase=3;st.timer=0;st.black=0;st.flash=1;
   E.shakeAdd(30*E.SC);E.setCA(0.015);E.flashAdd(0.7,1,.85,.55);
   const gy=E.H*0.5-0.30*Math.min(E.W,E.H);
   for(let i=0;i<120;i++){const s=Math.random()<0.5?-1:1;
    dustw.spawn(E.W*0.5+E.rnd(10,70)*s*E.SC,gy+E.rnd(-6,20)*E.SC,s*E.rnd(220,640)*E.SC,E.rnd(4,38)*E.SC,E.rnd(2.6,4.5),E.rnd(60,170)*E.SC,.24,.20,.18,E.rnd(.25,.45),3,{drag:.5,rot:Math.random()*E.TAU,rv:E.rnd(-.4,.4)});}}}
  else if(st.phase===3){
   const u=Math.min(1,st.timer/3.2);st.grow=E.easeOutCubic(u);st.age2=Math.min(1.4,st.timer*0.3);
   st.shock=E.easeOutQuart(Math.min(1,st.timer/1.5));if(st.shock>=1)st.shock=0;
   if(st.timer<2.5)E.shakeAdd((20*(1-st.timer/2.5)+2)*E.SC);
   if(st.timer<1.6){st.acc+=dt*40;const gy=E.H*0.5-0.30*Math.min(E.W,E.H);
    while(st.acc>1){st.acc--;ember.spawn(E.rnd(E.W*0.2,E.W*0.8),gy+E.rnd(0,E.H*0.3),E.rnd(-80,80),E.rnd(60,260)*E.SC,E.rnd(.6,1.4),E.rnd(2,6)*E.SC,1.4,.6,.2,E.rnd(.4,.8),0,{drag:.7,grav:-300*E.SC});}}
   if(st.timer>7){st.phase=4;st.timer=0;}}
  else{st.cloudA=Math.max(0,1-st.timer/1.3);st.age2=Math.min(1.5,st.age2+dt*0.2);if(st.timer>1.5){st.phase=0;st.timer=0;st.grow=0;st.cloudA=1;st.age2=0;}}
  dustw.update(dt,t,null);ember.update(dt,t,null);
 },
 drawField(t){if(!prog||!prog.p)return;const g=E.gl;g.useProgram(prog.p);
  g.uniform2f(prog.uRes,E.W,E.H);g.uniform1f(prog.uTime,t);g.uniform1f(prog.uWhite,st.white);g.uniform1f(prog.uBlack,st.black);
  g.uniform1f(prog.uGrow,st.grow);g.uniform1f(prog.uCloudA,st.cloudA);g.uniform1f(prog.uShock,st.shock);g.uniform1f(prog.uAge2,st.age2);g.uniform1f(prog.uFlash,st.flash);E.drawTri();},
 drawParticles(){if(st.black>0.5||st.white>0.5)return;E.drawPool(ember,E.ADD());E.drawPool(dustw,E.ALPHA());},
 countParticles(){return dustw.n+ember.n;}
});
})();
(function(){
"use strict";
const A=window.__ARC,E=A.env;
const FS=[
'#version 300 es','precision highp float;','#define TAU 6.2831853',
'uniform vec2 uRes;uniform float uTime,uFlash;',
'out vec4 o;',E.NOISE,
'void main(){',
' vec2 uv=gl_FragCoord.xy/uRes;',
' vec3 col=mix(vec3(.010,.014,.030),vec3(.002,.004,.012),clamp(length(uv-0.5)*1.2,0.,1.));',
' float st=smoothstep(.92,1.,n2(uv*vec2(uRes.x/uRes.y,1.)*220.));',          /* starfield */
' col+=vec3(.6,.7,.9)*st*0.5;',
' col+=vec3(.3,.6,1.0)*uFlash*0.25;',
' col*=1.-0.3*length(uv-0.5);',
' col+=(h21(uv*uRes+uTime)-.5)*.009;',
' o=vec4(col,1.0);',
'}'
].join('\n');
const trail=new E.Pool(1300),core=new E.Pool(160),ring=new E.Pool(900),spark=new E.Pool(520);
let prog=null;
const heads=[];const st={flash:0,timer:0,shots:0,cool:0};
function fade(p,i,dt){p.vx[i]*=Math.exp(-2.0*dt);p.vy[i]*=Math.exp(-2.0*dt);}
function shoot(){const fromL=Math.random()<0.5;
 const y=E.H*E.rnd(0.35,0.7);const sp=E.rnd(900,1300)*E.SC;
 heads.push({x:fromL?-E.W*0.05:E.W*1.05,y,vx:(fromL?1:-1)*sp,vy:E.rnd(-60,60)*E.SC,life:1.6,ringT:0});
 st.flash=1;E.flashAdd(.3,.6,1.0,.7);E.shakeAdd(8*E.SC);E.setCA(.012);}
A.reg({
 id:'FX-159',name:'혜성 창 연사',en:'Comet Lance Volley',
 desc:'심우주 별밭을 가로지르는 플라즈마 혜성-창 투사체 연사. 헤드는 강렬한 시안/백색 코어, 긴 모션블러 트레일을 끌고 고속 비행하며 일정 간격으로 충격파 링(파편 환형 버스트)을 탈피. 비행 방향 무작위(좌→우/우→좌) 스태거 발사, 색수차·플래시 가중.',
 tech:['Deep-Space Starfield','Plasma Comet Head','Long Motion-Blur Trail','Shed Shockwave Rings','Staggered Volley','Cyan/White Plasma'],
 bloom:0.95,
 init(){prog=E.U(E.mkProg(E.FS_VERT,FS,'FX159'),['uRes','uTime','uFlash']);},
 reset(){trail.clear();core.clear();ring.clear();spark.clear();heads.length=0;st.flash=0;st.timer=0;st.shots=0;st.cool=0;},
 resize(){},
 autoPoint(){return [E.W*0.5,E.H*0.5];},
 trigger(x,y){st.shots=4;st.cool=0;shoot();},
 update(dt,t){
  st.flash=Math.max(0,st.flash-dt*3.);
  if(st.shots>0){st.cool-=dt;if(st.cool<=0){st.cool=0.28;st.shots--;if(st.shots<3)shoot();}}
  for(let h=heads.length-1;h>=0;h--){const o2=heads[h];o2.life-=dt;
   o2.x+=o2.vx*dt;o2.y+=o2.vy*dt;
   const dir=Math.sign(o2.vx);
   /* core + trail */
   for(let k=0;k<2;k++)core.spawn(o2.x+E.rnd(-6,6)*E.SC,o2.y+E.rnd(-6,6)*E.SC,0,0,0.12,E.rnd(14,22)*E.SC,.7,.95,1.0,0.9,0,{});
   for(let k=0;k<4;k++){if(trail.n<1260)trail.spawn(o2.x-dir*E.rnd(0,30)*E.SC,o2.y+E.rnd(-8,8)*E.SC,-o2.vx*0.05,E.rnd(-30,30)*E.SC,E.rnd(.3,.6),E.rnd(5,12)*E.SC,.4,.8,1.0,E.rnd(.4,.7),0,{});}
   for(let k=0;k<2;k++){const a=Math.random()*E.TAU;spark.spawn(o2.x,o2.y,Math.cos(a)*E.rnd(80,360)*E.SC-o2.vx*0.1,Math.sin(a)*E.rnd(80,360)*E.SC,E.rnd(.25,.5),E.rnd(2,5)*E.SC,.7,.95,1.0,E.rnd(.6,.9),0,{});}
   /* shed shockwave ring */
   o2.ringT-=dt;if(o2.ringT<=0){o2.ringT=0.12;const N=26;for(let i=0;i<N;i++){const a=i/N*E.TAU;ring.spawn(o2.x,o2.y,Math.cos(a)*E.rnd(260,420)*E.SC,Math.sin(a)*E.rnd(260,420)*E.SC,E.rnd(.4,.7),E.rnd(3,6)*E.SC,.5,.85,1.0,E.rnd(.5,.8),0,{drag:1.6});}}
   if(o2.life<=0||o2.x<-E.W*0.1||o2.x>E.W*1.1)heads.splice(h,1);
  }
  trail.update(dt,t,fade);core.update(dt,t,null);ring.update(dt,t,null);spark.update(dt,t,fade);
 },
 drawField(t){if(!prog||!prog.p)return;const g=E.gl;g.useProgram(prog.p);
  g.uniform2f(prog.uRes,E.W,E.H);g.uniform1f(prog.uTime,t);g.uniform1f(prog.uFlash,st.flash);E.drawTri();},
 drawParticles(){E.drawPool(trail,E.ADD());E.drawPool(ring,E.ADD());E.drawPool(spark,E.ADD());E.drawPool(core,E.ADD());},
 countParticles(){return trail.n+core.n+ring.n+spark.n;}
});
})();
(function(){
"use strict";
const A=window.__ARC,E=A.env;
const FS=[
'#version 300 es','precision highp float;','#define TAU 6.2831853',
'uniform vec2 uRes;uniform float uTime;',
'out vec4 o;',E.NOISE,
'void main(){',
' vec2 uv=gl_FragCoord.xy/uRes;',
' vec3 col=mix(vec3(.006,.020,.014),vec3(.001,.006,.004),clamp(length(uv-0.5)*1.1,0.,1.));',
' float neb=fbm2(uv*3.0+vec2(uTime*.06,-uTime*.04));',
' col+=vec3(.02,.10,.06)*neb*neb;',
' col*=1.-0.28*length(uv-0.5);',
' col+=(h21(uv*uRes+uTime)-.5)*.009;',
' o=vec4(col,1.0);',
'}'
].join('\n');
const body=new E.Pool(1300),glowc=new E.Pool(220),arc=new E.Pool(620),mote=new E.Pool(360);
let prog=null;
const serpents=[];
function fade(p,i,dt){p.vx[i]*=Math.exp(-2.2*dt);p.vy[i]*=Math.exp(-2.2*dt);}
function spawnSerpent(fromL){const y=E.H*E.rnd(0.4,0.62);
 serpents.push({x:fromL?-E.W*0.05:E.W*1.05,base:y,dir:fromL?1:-1,life:2.2,ph:Math.random()*10});}
A.reg({
 id:'FX-160',name:'사룡 유선류',en:'Serpent Flux Stream',
 desc:'몸을 뒤트는 뱀(蛇龍)형 에메랄드 에너지 스트림이 사인+컬노이즈로 꿈틀대며 전진. 헤드가 지나간 경로를 따라 발광 보디 글린트가 연속 점등해 흐르는 유선을 형성하고, 간헐적으로 측면 아크 분기(번개)를 탈피한다. 직선·동심원 아닌 창발적 사행(蛇行) 궤적.',
 tech:['Sine + Curl Snaking Path','Continuous Body Glints','Shed Branch Arcs','Emerald Plasma','Flowing Stream Trail','Turbulent Nebula BG'],
 bloom:0.92,
 init(){prog=E.U(E.mkProg(E.FS_VERT,FS,'FX160'),['uRes','uTime']);},
 reset(){body.clear();glowc.clear();arc.clear();mote.clear();serpents.length=0;},
 resize(){},
 autoPoint(){return [E.W*0.5,E.H*0.5];},
 trigger(x,y){spawnSerpent(Math.random()<0.5);if(Math.random()<0.5)spawnSerpent(Math.random()<0.5);E.flashAdd(.2,.8,.4,.5);E.setCA(.008);},
 update(dt,t){
  const mn=Math.min(E.W,E.H);
  for(let h=serpents.length-1;h>=0;h--){const s=serpents[h];s.life-=dt;
   const spd=E.W*0.62; s.x+=s.dir*spd*dt;
   const c=E.curl2(s.x*0.004,s.base*0.004,s.ph);
   const y=s.base+Math.sin(s.x*0.012-t*4.+s.ph)*mn*0.10 + c[1]*mn*0.05;
   const vx=s.dir*spd, vy=Math.cos(s.x*0.012-t*4.)*mn*0.10*0.012*spd;
   for(let k=0;k<3;k++)glowc.spawn(s.x+E.rnd(-6,6)*E.SC,y+E.rnd(-6,6)*E.SC,0,0,0.1,E.rnd(12,20)*E.SC,.4,1.0,.6,0.9,0,{});
   for(let k=0;k<5;k++){if(body.n<1260)body.spawn(s.x-s.dir*E.rnd(0,24)*E.SC,y+E.rnd(-10,10)*E.SC,E.rnd(-30,30)*E.SC,E.rnd(-30,30)*E.SC,E.rnd(.4,.8),E.rnd(5,11)*E.SC,.3,1.0,.55,E.rnd(.4,.7),0,{});}
   for(let k=0;k<2;k++)mote.spawn(s.x,y,E.rnd(-60,60)*E.SC,E.rnd(-60,60)*E.SC,E.rnd(.3,.7),E.rnd(2,5)*E.SC,.6,1.0,.7,E.rnd(.5,.8),0,{drag:1.8});
   /* shed branch arc */
   if(Math.random()<0.12){const perp=(Math.random()<0.5?1:-1);const a=Math.atan2(vy,vx)+perp*Math.PI*0.5;
    for(let i=0;i<10;i++){const sp=E.rnd(120,520)*E.SC;arc.spawn(s.x,y,Math.cos(a)*sp+E.rnd(-60,60)*E.SC,Math.sin(a)*sp+E.rnd(-60,60)*E.SC,E.rnd(.2,.45),E.rnd(2,5)*E.SC,.7,1.0,.8,E.rnd(.6,.9),0,{drag:2.0});}}
   if(s.life<=0||s.x<-E.W*0.12||s.x>E.W*1.12)serpents.splice(h,1);
  }
  body.update(dt,t,fade);glowc.update(dt,t,null);arc.update(dt,t,null);mote.update(dt,t,null);
 },
 drawField(t){if(!prog||!prog.p)return;const g=E.gl;g.useProgram(prog.p);
  g.uniform2f(prog.uRes,E.W,E.H);g.uniform1f(prog.uTime,t);E.drawTri();},
 drawParticles(){E.drawPool(body,E.ADD());E.drawPool(arc,E.ADD());E.drawPool(mote,E.ADD());E.drawPool(glowc,E.ADD());},
 countParticles(){return body.n+glowc.n+arc.n+mote.n;}
});
})();
(function(){
"use strict";
const A=window.__ARC,E=A.env;
const FS=`#version 300 es
precision highp float;
out vec4 o;
uniform vec2 uRes; uniform float uTime;      // continuous time (rotation)
uniform float uHole; uniform float uRift; uniform float uFade;

float hash(vec3 p){ return fract(sin(dot(p,vec3(17.1,113.5,71.7)))*43758.5453); }
float noise(vec3 p){
  vec3 i=floor(p),f=fract(p); f=f*f*(3.-2.*f);
  float n=mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
              mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);
  return n;
}
float fbm(vec3 p){ float s=0.,a=.5; for(int i=0;i<5;i++){ s+=a*noise(p); p*=2.03; a*=.5; } return s; }

vec3 starfield(vec3 d){
  vec3 ad=abs(d); float m=max(ad.x,max(ad.y,ad.z));
  vec2 uv = (m==ad.x? d.yz/ad.x : (m==ad.y? d.xz/ad.y : d.xy/ad.z));
  vec2 g=floor(uv*60.0); float r=hash(vec3(g,3.0));
  float st=smoothstep(0.992,1.0,r)*step(0.5,r);
  float tw=0.6+0.4*sin(uTime*2.0+r*40.0);
  vec3 neb = (0.5+0.5*vec3(0.35,0.18,0.55))* fbm(d*2.2+uTime*0.02)*0.10;
  return neb + vec3(st*tw);
}

// accretion disk color sampled at hit point hp (y~0)
vec3 disk(vec3 hp, vec3 vel){
  float r=length(hp.xz);
  float ang=atan(hp.z,hp.x);
  float spiral = fbm(vec3(cos(ang)*r,sin(ang)*r,0.0)*3.0 + vec3(0.,0.,uTime*1.4) + ang*1.5 - uTime*0.9);
  float band = smoothstep(0.55,0.75,r)*(1.-smoothstep(1.3,2.7,r));
  // temperature ramp inner->outer : white -> magenta -> cyan/blue
  float tnorm = clamp((r-0.55)/2.0,0.,1.);
  vec3 hot = mix(vec3(1.0,0.95,0.85), vec3(1.0,0.30,0.95), smoothstep(0.0,0.5,tnorm));
  vec3 col = mix(hot, vec3(0.30,0.65,1.0), smoothstep(0.4,1.0,tnorm));
  // doppler: brighten tangential approaching side
  vec3 tang = normalize(vec3(-hp.z,0.0,hp.x));
  float dop = 0.6+0.9*max(dot(tang, normalize(vel)),0.0);
  float bright = band*(0.35+spiral*0.9)*dop;
  return col*bright*2.2;
}

void main(){
  vec2 uv=((gl_FragCoord.xy/uRes)*2.0-1.0); uv.x*=uRes.x/uRes.y;
  // camera
  vec3 cam=vec3(0.0,0.55,-4.2);
  vec3 fwd=normalize(vec3(0.0)-cam);
  vec3 rgt=normalize(cross(vec3(0,1,0),fwd));
  vec3 up =cross(fwd,rgt);
  vec3 dir=normalize(fwd + uv.x*rgt*0.90 + uv.y*up*0.90);

  vec3 col=vec3(0.0);
  float GM=0.50*uHole;
  float Rs=0.34*max(uHole,0.001);
  vec3 pos=cam, prev=cam;
  bool swallowed=false;
  float dl=0.12;
  for(int i=0;i<140;i++){
    float r=length(pos);
    if(r<Rs){ swallowed=true; break; }
    vec3 g=-pos/(r*r*r)*GM;          // gravity bends photon
    dir=normalize(dir+g*dl);
    prev=pos; pos+=dir*dl;
    // disk plane crossing y=0
    if(prev.y*pos.y<0.0){
      float t=prev.y/(prev.y-pos.y);
      vec3 hp=mix(prev,pos,t);
      float rr=length(hp.xz);
      if(rr>0.55 && rr<2.75){ col+=disk(hp,dir); }
    }
  }
  if(!swallowed) col+=starfield(dir);

  // einstein-ring rim glow near horizon silhouette
  float rim=smoothstep(Rs*1.9,Rs*1.0, length((cam+dir).xz))*0.0; // (kept subtle; disk dominates)
  col+=rim;

  // ── rift phase: jagged purple tear collapsing to center ──
  if(uRift>0.001){
    float x=uv.x;
    float edge=fbm(vec3(uv.y*6.0, uTime*1.5, 0.0))*0.10;
    float w=0.045*uRift + edge*uRift;
    float tear=smoothstep(w,0.0,abs(x))*uRift;
    float core=smoothstep(w*0.4,0.0,abs(x));
    vec3 rc=mix(vec3(0.55,0.12,0.95), vec3(0.95,0.7,1.0), core);
    col+=rc*tear*1.6;
    col+=vec3(0.4,0.1,0.7)*(1.-smoothstep(0.0,0.5,abs(x)))*uRift*0.15;
  }

  col=pow(max(col,0.),vec3(0.92))*1.06;
  col=mix(vec3(dot(col,vec3(0.299,0.587,0.114))),col,1.12);
  col+=vec3(0.03,0.01,0.06)*(1.-smoothstep(0.,0.3,col));
  col*=uFade;
  o=vec4(col,1.0);
}`;
let prog=null; const st={t:0};
A.reg({
 id:'ARC-25',name:'사건의 지평선 낫','en':'Event Horizon Scythe',
 desc:'공간이 찢어지며(rift) 블랙홀이 태어나 중력렌즈로 별빛을 휘감고, 강착원반이 회전·발광하는 사건의 지평선. 별·성운 배경 포함. opus 포팅(단일 레이마칭).',
 tech:['Gravitational Lensing','Accretion Disk','Rift Birth','Starfield+Nebula','Raymarch'],bloom:0.95,
 init(){prog=E.U(E.mkProg(E.FS_VERT,FS,'ARC25'),['uRes','uTime','uHole','uRift','uFade']);},
 reset(){st.t=0;}, resize(){},
 autoPoint(){return [E.W*0.5,E.H*0.5];},
 trigger(x,y){st.t=0;},
 update(dt,t){st.t+=dt;},
 drawField(t){if(!prog||!prog.p)return;const g=E.gl;g.useProgram(prog.p);
  g.uniform2f(prog.uRes,E.W,E.H);g.uniform1f(prog.uTime,st.t);
  const C=10.0,p=st.t%C;let rift=0,hole=0,fade=1;
  if(p<2.0){rift=E.smoothstep(0,1.2,p);hole=0;}
  else if(p<3.2){const k=(p-2.0)/1.2;rift=(1-E.smoothstep(0,1,k))*0.9;hole=E.smoothstep(0,1,k);}
  else {rift=0;hole=1;}
  if(p<0.8)fade=E.smoothstep(0,0.8,p);else if(p>=8.0)fade=1-E.smoothstep(0,2.0,p-8.0);
  g.uniform1f(prog.uHole,hole);g.uniform1f(prog.uRift,rift);g.uniform1f(prog.uFade,fade);
  E.drawTri();},
 drawParticles(){}, countParticles(){return 0;}
});
})();
(function(){
"use strict";
const A=window.__ARC,E=A.env;
const BASE=`#version 300 es
precision highp float;
 out vec4 o;
uniform vec2 uRes; uniform float uTime;
float hh(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float nn(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(hh(i),hh(i+vec2(1,0)),f.x),mix(hh(i+vec2(0,1)),hh(i+vec2(1,1)),f.x),f.y); }
float fbm(vec2 p){ float s=0.,a=.5; for(int i=0;i<5;i++){s+=a*nn(p);p*=2.05;a*=.5;} return s; }
void main(){
  vec2 uv=((gl_FragCoord.xy/uRes)*2.-1.); uv.x*=uRes.x/uRes.y;
  float f=fbm(uv*1.6+vec2(uTime*0.06,uTime*0.04));
  float g=fbm(uv*2.4-vec2(uTime*0.05,0.0));
  vec3 col=vec3(0.04,0.06,0.12);
  col+=vec3(0.1,0.7,0.85)*pow(f,1.5)*1.1;            // teal aurora
  col+=vec3(0.65,0.2,0.85)*pow(g,2.0)*0.9;           // violet veils
  col+=vec3(0.9,0.95,1.0)*pow(hh(floor(uv*60.+.5)),50.)*4.0; // stars
  o=vec4(col,1.);
}`;
const FRAC=`#version 300 es
precision highp float;
 out vec4 o;
uniform vec2 uRes; uniform float uTime,uShatter,uFade; uniform sampler2D uS;
float hh(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
void main(){
  vec2 uv=((gl_FragCoord.xy/uRes)*2.-1.); float asp=uRes.x/uRes.y; uv.x*=asp;
  // voronoi cells
  vec2 g=floor(uv*4.5), f=fract(uv*4.5);
  float md=10.,md2=10.; vec2 mc=vec2(0.),mg=vec2(0.);
  for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++){
    vec2 go=vec2(float(x),float(y));
    vec2 jit=vec2(hh(g+go),hh(g+go+5.7));
    vec2 d=go+jit-f; float dd=dot(d,d);
    if(dd<md){ md2=md; md=dd; mc=g+go+jit; mg=g+go; } else if(dd<md2){ md2=dd; }
  }
  float seam=smoothstep(0.0,0.05,sqrt(md2)-sqrt(md));   // 0 at borders
  float cid=hh(mg+1.3);
  vec2 ccen=(mc)/4.5;                                   // cell center, uv space
  vec2 dir=normalize(uv-ccen+1e-4);
  // tumble: shard slides + refraction offset grows with shatter
  float amt=uShatter*(0.5+cid);
  vec2 slide=dir*amt*0.18;
  vec2 refr=vec2(hh(mg+9.1)-0.5,hh(mg+2.2)-0.5)*amt*0.10;
  vec2 su=uv - slide + refr;
  su.x/=asp; vec2 tuv=su*0.5+0.5;
  // chromatic refraction per shard
  float ca=amt*0.012;
  vec3 col;
  col.r=texture(uS,tuv+dir*ca*vec2(1./asp,1.)).r;
  col.g=texture(uS,tuv).g;
  col.b=texture(uS,tuv-dir*ca*vec2(1./asp,1.)).b;
  // bright fracture seams
  float edge=(1.-smoothstep(0.0,0.03,seam))*uShatter;
  col+=vec3(0.8,0.92,1.0)*edge*1.3;
  // facet shading: darken by shard orientation
  float facet=0.85+0.15*cos(cid*30.+uTime*0.5);
  col*=mix(1.0,facet,uShatter);
  o=vec4(col*uFade,1.);
}`;
let pb=null,pf=null,fbo=null,tex=null,fw=0,fh=0; const st={t:0};
function mkfbo(w,h){ const g=E.gl;
  if(fbo){g.deleteFramebuffer(fbo);g.deleteTexture(tex);}
  tex=g.createTexture(); g.bindTexture(g.TEXTURE_2D,tex);
  g.texImage2D(g.TEXTURE_2D,0,g.RGBA8,w,h,0,g.RGBA,g.UNSIGNED_BYTE,null);
  g.texParameteri(g.TEXTURE_2D,g.TEXTURE_MIN_FILTER,g.LINEAR);
  g.texParameteri(g.TEXTURE_2D,g.TEXTURE_MAG_FILTER,g.LINEAR);
  g.texParameteri(g.TEXTURE_2D,g.TEXTURE_WRAP_S,g.CLAMP_TO_EDGE);
  g.texParameteri(g.TEXTURE_2D,g.TEXTURE_WRAP_T,g.CLAMP_TO_EDGE);
  fbo=g.createFramebuffer(); g.bindFramebuffer(g.FRAMEBUFFER,fbo);
  g.framebufferTexture2D(g.FRAMEBUFFER,g.COLOR_ATTACHMENT0,g.TEXTURE_2D,tex,0);
  g.bindFramebuffer(g.FRAMEBUFFER,null); fw=w;fh=h;
}
A.reg({
 id:'ARC-32',name:'거울 파쇄',en:'Mirror Shatter',
 desc:'자체 생성한 거울 씬을 보로노이 파편으로 산산조각내어 각 조각이 굴절·표류·낙하하는 차원 거울 파쇄. 자체 FBO 1패스 캡처→파편 굴절 2패스. opus 포팅(앱 이전프레임 불필요·자기완결).',
 tech:['Self Base-Scene Capture','Voronoi Shard Fracture','Per-Shard Refraction','Drift + Fall','RGBA8 FBO (no float ext)'],bloom:0.6,
 init(){ pb=E.U(E.mkProg(E.FS_VERT,BASE,'ARC32B'),['uRes','uTime']);
   pf=E.U(E.mkProg(E.FS_VERT,FRAC,'ARC32F'),['uRes','uTime','uShatter','uFade','uS']);
   mkfbo(E.W,E.H); },
 reset(){ st.t=0; },
 resize(w,h){ mkfbo(w||E.W,h||E.H); },
 autoPoint(){ return [E.W*0.5,E.H*0.5]; },
 trigger(x,y){ st.t=0; },
 update(dt,t){ st.t+=dt; },
 drawField(t){ if(!pb||!pb.p||!pf||!pf.p)return; const g=E.gl;
   if(fw!==E.W||fh!==E.H) mkfbo(E.W,E.H);
   const ph=st.t%9.0; let sh,fade=1;
   if(ph<1.2)sh=0; else if(ph<4.0)sh=E.smoothstep(1.2,4.0,ph); else if(ph<6.5)sh=1;
   else { sh=1-E.smoothstep(6.5,8.5,ph); if(ph>7.0)fade=1-E.smoothstep(7.0,9.0,ph); }
   const tgt=g.getParameter(g.FRAMEBUFFER_BINDING);
   g.bindFramebuffer(g.FRAMEBUFFER,fbo); g.viewport(0,0,E.W,E.H); g.disable(g.BLEND);
   g.useProgram(pb.p); g.uniform2f(pb.uRes,E.W,E.H); g.uniform1f(pb.uTime,st.t); E.drawTri();
   g.bindFramebuffer(g.FRAMEBUFFER,tgt); g.viewport(0,0,E.W,E.H);
   g.activeTexture(g.TEXTURE0); g.bindTexture(g.TEXTURE_2D,tex);
   g.useProgram(pf.p); g.uniform2f(pf.uRes,E.W,E.H); g.uniform1f(pf.uTime,st.t);
   g.uniform1f(pf.uShatter,sh); g.uniform1f(pf.uFade,fade); g.uniform1i(pf.uS,0);
   E.drawTri();
 },
 drawParticles(){}, countParticles(){ return 0; }
});
})();
(function(){
"use strict";
const A=window.__ARC,E=A.env;
const PI=Math.PI;
const FS=[
'#version 300 es','precision highp float;','#define PI 3.14159265',
'uniform vec2 uRes,uC;uniform float uTime,uAlive,uReveal,uHeadS,uStamp,uSeedF;',
'out vec4 o;',E.NOISE,
'vec2 spine(float t){',
' float y=-0.95+1.78*t;',
' float s1=sin(t*2.0*PI+0.4);',
' float s2=sin(t*4.6*PI+0.6+uTime*0.4);',
' float amp=0.17*(0.45+0.55*sin(PI*t));',
' float x=0.18*s1+amp*s2*0.5;',
' return vec2(x,y);',
'}',
'float rad(float t){',
' float mid=0.044*pow(clamp(sin(PI*clamp(t,0.,1.)),0.,1.),0.6);',
' float neck=0.030*exp(-pow((t-0.84)/0.06,2.));',
' float tail=clamp(t/0.10,0.,1.);',
' return (0.040+mid+neck)*tail;',
'}',
'float segd(vec2 p,vec2 a,vec2 b){vec2 pa=p-a,ba=b-a;float h=clamp(dot(pa,ba)/dot(ba,ba),0.,1.);return length(pa-ba*h);}',
'void main(){',
' float mn=min(uRes.x,uRes.y);',
' vec2 uv=(gl_FragCoord.xy-uC)/mn;',
' float grain=fbm2(uv*7.+vec2(uSeedF*9.,0.));',
' vec3 col=vec3(.62,.565,.45)*(.9+.12*grain);',
' float fib=n2(uv*90.+vec2(uSeedF*31.,7.));',
' col-=vec3(.06,.055,.05)*smoothstep(.965,1.,fib);',
' float shaft=smoothstep(.2,.9,fbm2(vec2(uv.x*1.2-uv.y*.8,uTime*.02)));',
' col+=vec3(.07,.06,.035)*shaft*clamp(uv.y+.6,0.,1.)*.6;',
' col*=1.-.16*clamp(dot(uv,uv)*1.5,0.,1.);',
' float val=0.0;',
' col=mix(col,vec3(.05,.06,.11),clamp(val,0.,1.)*uAlive);',
' if(uStamp>0.001){',
'  vec2 qs=uv-vec2(.33,-.30);float c2=cos(-.07),s3=sin(-.07);qs=mat2(c2,-s3,s3,c2)*qs;',
'  float sc2=max(uStamp,.05);qs/=sc2;',
'  vec2 b=abs(qs)-vec2(.066,.073);',
'  float rr=length(max(b,vec2(0.)))+min(max(b.x,b.y),0.)-.012;',
'  float fill=1.-smoothstep(0.,.008,rr);',
'  float carve=smoothstep(.42,.6,fbm2(qs*26.+vec2(uSeedF*17.,3.)));',
'  float inner=fill*(1.-carve*.8);',
'  float edgeBleed=exp(-max(rr,0.)*60.)*.25;',
'  col=mix(col,vec3(.72,.14,.10),clamp(inner+edgeBleed*fill,0.,1.)*clamp(uStamp,0.,1.));',
'  col*=1.-fill*.06;',
' }',
' o=vec4(col,1.);',
'}'
].join('\n');
const INK_VS=[
'#version 300 es',
'layout(location=0) in vec2 aPos;layout(location=1) in vec2 aUV;layout(location=2) in float aFade;',
'uniform vec2 uRes;out vec2 vUV;out float vF;',
'void main(){gl_Position=vec4(aPos/uRes*2.-1.,0.,1.);vUV=aUV;vF=aFade;}'
].join('\n');
const INK_FS=[
'#version 300 es','precision highp float;',
'in vec2 vUV;in float vF;out vec4 o;',E.NOISE,
'void main(){',
' float v=vUV.y*2.-1.;float u=vUV.x;',
' float body=1.-smoothstep(.55,1.,abs(v));',
' float dry=smoothstep(.10,.46,n2(vec2(u*24.,v*2.5+u*3.))*.75+body*.55);',
' float a=body*dry;',
' vec3 ink=mix(vec3(.11,.13,.21),vec3(.04,.045,.075),clamp(a*1.5,0.,1.));',
' o=vec4(ink,a*vF);',
'}'
].join('\n');
const MAXS=6,SEG=36,FPV=5;
const verts=new Float32Array(MAXS*SEG*2*FPV);
const sx=new Float32Array(MAXS*SEG),sy=new Float32Array(MAXS*SEG),sw=new Float32Array(MAXS),st0=new Float32Array(MAXS);
const blot=new E.Pool(384),drop=new E.Pool(512),mote=new E.Pool(192),mist=new E.Pool(256);
let prog=null,iprog=null,vbo=null,vao=null;
const st={phase:0,timer:0,cx:0,cy:0,alive:1,reveal:0,headS:0,stamp:0,seedF:0,stroke:0,acc:0};
const LAYOUT=[[-.42,.18,.0,.32,.40,.22,1.0,0.00],[-.05,.44,.08,-.02,-.12,-.40,1.15,0.37],[-.30,.05,-.42,-.10,-.46,-.34,0.8,0.74],[.10,.02,.20,-.24,.46,-.38,0.95,1.05],[.24,.36,.36,.34,.33,.23,1.35,1.40]];
function quad(ax,ay,bx,by,cx,cy,u){const w=1-u;return [w*w*ax+2*w*u*bx+u*u*cx,w*w*ay+2*w*u*by+u*u*cy];}
function genStrokes(){const m=Math.min(E.W,E.H)*0.5;for(let k=0;k<5;k++){const L=LAYOUT[k];
 for(let i=0;i<SEG;i++){const u=i/(SEG-1);const p=quad(L[0],L[1],L[2]+E.rnd(-.02,.02),L[3]+E.rnd(-.02,.02),L[4],L[5],u);sx[k*SEG+i]=st.cx+p[0]*m;sy[k*SEG+i]=st.cy+p[1]*m;}sw[k]=L[6]*13*E.SC;st0[k]=L[7];}}
function press(u){return (0.35+0.95*Math.pow(Math.sin(Math.PI*Math.min(u*1.25,1)),0.7))*(1-E.smoothstep(0.72,1,u)*0.75);}
function spineXY(t){const m=Math.min(E.W,E.H);const y=-0.95+1.78*t;const s1=Math.sin(t*2*PI+0.4),s2=Math.sin(t*4.6*PI+0.6),amp=0.17*(0.45+0.55*Math.sin(PI*t));const x=0.18*s1+amp*s2*0.5;return [E.W*0.5+x*m,E.H*0.52+y*m];}
function blotAt(x,y,big){blot.spawn(x,y,E.rnd(-4,4),E.rnd(-4,4),E.rnd(5,9),E.rnd(big?40:16,big?100:44)*E.SC,.06,.07,.11,E.rnd(.10,.2),3,{rot:Math.random()*E.TAU,rv:E.rnd(-.1,.1)});}
function splash(x,y){E.shakeAdd(12*E.SC);E.flashAdd(0.25,1,.9,.7);E.setCA(0.005);
 for(let i=0;i<90;i++){const a=Math.random()*E.TAU,sp=E.rnd(180,950)*E.SC,vx=Math.cos(a)*sp,vy=Math.sin(a)*sp;
  drop.spawn(x,y,vx,vy,E.rnd(.4,.9),E.rnd(5,14)*E.SC,.07,.08,.13,E.rnd(.5,.85),1,{rot:Math.atan2(vy,vx)+Math.PI/2,drag:2.2,grav:-600*E.SC});}
 for(let i=0;i<22;i++)blotAt(x+E.rnd(-70,70)*E.SC,y+E.rnd(-70,70)*E.SC,Math.random()<0.4);}
A.reg({
 id:'FB-01',name:'묵향 · 일필낙관',en:'Ink Calligraphy — Fable Original',
 desc:'한지 위에 다섯 획이 압력 프로파일로 운필되어 쓰이고, 비백·먹 번짐과 먹방울이 튄 뒤 주묵 낙관으로 마무리되는 수묵 서예. 용/생물 형상 없이 필획과 먹의 농담만으로 구성. 한지 섬유·빛 결 절차 생성.',
 tech:['Pressure-Profiled Brush Strokes','Flying-White / Ink Bleed','Hanji Paper Field','Ink Spatter','Vermillion Seal'],
 bloom:0.4,
 init(){const g=E.gl;prog=E.U(E.mkProg(E.FS_VERT,FS,'FB01'),['uRes','uC','uTime','uAlive','uReveal','uHeadS','uStamp','uSeedF']);
  iprog=E.U(E.mkProg(INK_VS,INK_FS,'FB01i'),['uRes']);
  vbo=g.createBuffer();g.bindBuffer(g.ARRAY_BUFFER,vbo);g.bufferData(g.ARRAY_BUFFER,verts.byteLength,g.DYNAMIC_DRAW);
  vao=g.createVertexArray();g.bindVertexArray(vao);g.bindBuffer(g.ARRAY_BUFFER,vbo);
  g.enableVertexAttribArray(0);g.vertexAttribPointer(0,2,g.FLOAT,false,FPV*4,0);
  g.enableVertexAttribArray(1);g.vertexAttribPointer(1,2,g.FLOAT,false,FPV*4,8);
  g.enableVertexAttribArray(2);g.vertexAttribPointer(2,1,g.FLOAT,false,FPV*4,16);g.bindVertexArray(null);},
 reset(){blot.clear();drop.clear();mote.clear();mist.clear();st.phase=0;st.timer=0;st.alive=1;st.reveal=0;st.headS=0;st.stamp=0;st.stroke=0;st.acc=0;st.seedF=Math.random();st.cx=E.W*0.5;st.cy=E.H*0.52;},
 resize(){st.cx=E.W*0.5;st.cy=E.H*0.52;},
 autoPoint(){return [E.W*0.5,E.H*0.52];},
 trigger(){if(st.phase!==0)return;st.phase=1;st.timer=0;st.stroke=0;st.alive=1;st.reveal=0;st.headS=0;st.stamp=0;st.seedF=Math.random();genStrokes();},
 update(dt,t){
  st.timer+=dt;
  if(st.phase===0){st.acc+=dt*5;while(st.acc>1){st.acc--;mote.spawn(E.rnd(0,E.W),E.rnd(0,E.H),E.rnd(-8,8),E.rnd(5,20)*E.SC,E.rnd(4,8),E.rnd(1.5,4)*E.SC,.9,.85,.7,E.rnd(.06,.14),0,{seed:Math.random()});}st.reveal=Math.max(0,st.reveal-dt);st.headS=Math.max(0,st.headS-dt*2);}
  else if(st.phase===1){const k=st.stroke;
   if(k<5){const sT=st0[k];if(st.timer>sT){const u=(st.timer-sT)/0.26;if(u>=1){st.stroke++;E.shakeAdd(1.6*E.SC);for(let b=0;b<5;b++){const i=Math.floor(E.rnd(0,SEG));blotAt(sx[k*SEG+i],sy[k*SEG+i],false);}}}}
   if(st.stroke>=5&&st.timer>1.95){st.phase=3;st.timer=0;splash(st.cx,st.cy);}}
  else if(st.phase===3){
   st.acc+=dt*16;while(st.acc>1){st.acc--;mist.spawn(st.cx+E.rnd(-70,70)*E.SC,st.cy+E.rnd(-50,50)*E.SC,E.rnd(-16,16)*E.SC,E.rnd(20,60)*E.SC,E.rnd(1,1.8),E.rnd(12,28)*E.SC,.12,.13,.20,E.rnd(.1,.22),3,{drag:.8});}
   if(st.timer>0.5&&st.stamp<=0){st.stamp=0.001;E.shakeAdd(7*E.SC);E.flashAdd(0.2,1,.7,.5);}
   if(st.stamp>0)st.stamp=Math.min(1,st.stamp+dt*9);
   if(st.timer>2.8){st.phase=4;st.timer=0;}}
  else{st.alive=Math.max(0,1-st.timer/1.2);st.stamp=st.alive;if(st.timer>1.5){st.phase=0;st.timer=0;st.alive=1;st.reveal=0;st.stamp=0;}}
  blot.update(dt,t,null);drop.update(dt,t,null);mote.update(dt,t,null);mist.update(dt,t,null);
 },
 drawField(t){if(!prog||!prog.p)return;const g=E.gl;g.useProgram(prog.p);
  g.uniform2f(prog.uRes,E.W,E.H);g.uniform2f(prog.uC,st.cx||E.W*0.5,st.cy||E.H*0.52);
  g.uniform1f(prog.uTime,t);g.uniform1f(prog.uAlive,st.alive);g.uniform1f(prog.uReveal,0.);g.uniform1f(prog.uHeadS,0.);g.uniform1f(prog.uStamp,st.stamp*st.alive);g.uniform1f(prog.uSeedF,st.seedF);E.drawTri();},
 drawParticles(t){const g=E.gl;
  E.drawPool(blot,E.ALPHA());E.drawPool(mist,E.ALPHA());
  let vi=0;const ranges=[];
  for(let k=0;k<5;k++){let rev=0;if(st.phase===1)rev=E.clamp((st.timer-st0[k])/0.26,0,1);else rev=1;if(rev<=0||st.alive<=0.01)continue;
   const start=vi/FPV;
   for(let i=0;i<SEG;i++){const u=i/(SEG-1);const px=sx[k*SEG+i],py=sy[k*SEG+i];
    const a2=Math.max(0,i-1),b2=Math.min(SEG-1,i+1);let tx=sx[k*SEG+b2]-sx[k*SEG+a2],ty=sy[k*SEG+b2]-sy[k*SEG+a2];const tl=Math.hypot(tx,ty)||1;const nx=-ty/tl,ny=tx/tl;
    const w=Math.min(sw[k]*press(u),sw[k]*press(u)*E.clamp(rev*1.15-u,0,1)*4);
    verts[vi++]=px+nx*w;verts[vi++]=py+ny*w;verts[vi++]=u*1.6+k*13.7;verts[vi++]=0;verts[vi++]=st.alive*Math.min(1,rev*2);
    verts[vi++]=px-nx*w;verts[vi++]=py-ny*w;verts[vi++]=u*1.6+k*13.7;verts[vi++]=1;verts[vi++]=st.alive*Math.min(1,rev*2);}
   ranges.push({start,count:SEG*2});}
  if(ranges.length&&iprog&&iprog.p){g.useProgram(iprog.p);g.uniform2f(iprog.uRes,E.W,E.H);g.blendFunc(g.SRC_ALPHA,g.ONE_MINUS_SRC_ALPHA);
   g.bindVertexArray(vao);g.bindBuffer(g.ARRAY_BUFFER,vbo);g.bufferSubData(g.ARRAY_BUFFER,0,verts.subarray(0,vi));
   for(const r of ranges)g.drawArrays(g.TRIANGLE_STRIP,r.start,r.count);g.bindVertexArray(null);}
  E.drawPool(drop,E.ALPHA());E.drawPool(mote,E.ADD());},
 countParticles(){return blot.n+drop.n+mote.n+mist.n+(st.alive>0.01?5*SEG:0);}
});
})();
(function(){
"use strict";
const A=window.__ARC,E=A.env;
const FS=[
'#version 300 es',
'precision highp float;',
'uniform vec2 uRes;uniform float uTime,uRise,uFrost,uFrostA,uGlowF,uCryA;',
'out vec4 o;',
E.NOISE,
'float sdOcta(vec3 p,float s,float st){',
' p.y*=st;',
' return (abs(p.x)+abs(p.y)+abs(p.z)-s)*0.55;',
'}',
'float mapC(vec3 p){',
' float d=1e3;',
' for(int i=0;i<5;i++){',
'  float fi=float(i);',
'  float big=(i==0)?1.:0.;',
'  float a=fi*2.51+.6;',
'  vec2 rdir=vec2(cos(a),sin(a));',
'  float rad=mix(.36+.05*sin(fi*3.7),0.,big);',
'  vec3 q=p-vec3(rdir.x*rad,mix(-.34-.08*sin(fi*2.2),0.,big),rdir.y*rad);',
'  float tl=mix(.24,0.,big);',
'  float ca=cos(tl),sa=sin(tl);',
'  float qr=dot(q.xz,rdir);',
'  vec2 yz=mat2(ca,-sa,sa,ca)*vec2(q.y,qr);',
'  q.xz+=rdir*(yz.y-qr);',
'  q.y=yz.x;',
'  float sc=mix(.20+.045*sin(fi*5.1),.40,big);',
'  float stt=mix(.50,.42,big);',
'  d=min(d,sdOcta(q,sc,stt));',
' }',
' d+=(fbm3(p*5.5)-.5)*.028;',
' return d;',
'}',
'void main(){',
' vec2 uv=(gl_FragCoord.xy-uRes*.5)/uRes.y;',
' vec3 ro=vec3(0.,0.5,-3.2);',
' vec3 rd=normalize(vec3(uv,1.7));',
' float cp=0.96891,sp=0.24740;',
' rd=vec3(rd.x,cp*rd.y-sp*rd.z,sp*rd.y+cp*rd.z);',
' vec3 col=mix(vec3(.003,.01,.022),vec3(.012,.04,.065),clamp(.5-uv.y,0.,1.));',
' float au=fbm2(vec2(uv.x*1.6-uTime*.04,(uv.y-.1)*3.2-fbm2(vec2(uv.x*2.2+5.,uTime*.03))*1.5));',
' float band=smoothstep(.42,.85,au)*clamp((uv.y+.12)*2.0,0.,1.);',
' vec3 aurC=mix(vec3(.04,.42,.3),vec3(.26,.2,.62),clamp(uv.y*1.7+.25,0.,1.));',
' col+=aurC*band*.55;',
' float str=n2(uv*70.+vec2(7.3,2.1));',
' col+=vec3(.5,.65,.85)*smoothstep(.97,1.,str)*(.4+.6*n2(uv*9.+vec2(uTime*.6,0.)));',
' float tr=1.;vec3 acc=vec3(0.);',
' float cy=-2.03+1.814*uRise;',
' if(uRise>0.02&&uCryA>0.01){',
'  vec3 cc=vec3(0.,cy,0.);',
'  vec3 oc=ro-cc;',
'  float b=dot(oc,rd),c2=dot(oc,oc)-1.15;',
'  float h=b*b-c2;',
'  if(h>0.){',
'   h=sqrt(h);',
'   float t=max(-b-h,0.),t1=-b+h;',
'   float dtS=(t1-t)/44.;',
'   for(int i=0;i<44;i++){',
'    if(t>t1)break;',
'    vec3 p=ro+rd*t-cc;',
'    float d=mapC(p);',
'    if(d>0.06){t+=max(dtS,d*0.7);continue;}',
'    float inside=1.-smoothstep(-0.02,0.03,d);',
'    float depth=clamp(-d*5.,0.,1.);',
'    float vein=1.-smoothstep(0.,.05,abs(fbm3(p*3.4+vec3(0.,uTime*.05,0.))-.5));',
'    float spark=smoothstep(.62,.85,fbm3(p*9.+vec3(0.,uTime*.13,0.)));',
'    float ax=exp(-(p.x*p.x+p.z*p.z)*34.)*(1.-smoothstep(.15,.85,abs(p.y)));',
'    vec3 em=mix(vec3(.30,.62,.82),vec3(.03,.22,.42),depth)*.85;',
'    em+=vec3(.55,1.05,1.25)*vein*1.15;',
'    em+=vec3(1.05,1.5,1.75)*spark*1.3;',
'    em+=vec3(1.2,1.55,1.8)*ax*1.6;',
'    float rim=1.-smoothstep(0.,0.035,abs(d));',
'    vec3 rimC=mix(vec3(.5,.95,1.15),vec3(.72,.58,1.22),clamp(p.y*.8+.5,0.,1.));',
'    em+=rimC*rim;',
'    float dens=(inside*(1.3+vein*1.6+spark*1.8+ax*2.)+rim*1.8)*uCryA;',
'    float a2=1.-exp(-dens*dtS*3.8);',
'    acc+=em*a2*tr;tr*=1.-a2;',
'    if(tr<0.03)break;',
'    t+=dtS;',
'   }',
'  }',
' }',
' if(rd.y<-0.02&&uFrost>0.001&&tr>0.02){',
'  float tf=(-1.0-ro.y)/rd.y;',
'  vec3 fp=ro+rd*tf;',
'  float r=length(fp.xz);',
'  if(r<7.){',
'   float cr=abs(fbm2(fp.xz*3.2)*2.-1.);',
'   float vein=1.-smoothstep(0.,.2,cr);',
'   float plate=fbm2(fp.xz*1.3+vec2(7.1,3.3));',
'   float tw=.65+.55*n2(fp.xz*22.+vec2(uTime*1.4,0.));',
'   float mask=1.-smoothstep(uFrost*.6,max(uFrost,1e-3),r);',
'   float fog=exp(-tf*.22);',
'   vec3 fc=vec3(.10,.34,.5)*plate*.6+vec3(.4,.9,1.2)*vein*tw;',
'   acc+=fc*mask*fog*tr*uFrostA;',
'  }',
' }',
' col=col*tr+acc;',
' col+=vec3(.5,.9,1.15)*uGlowF*exp(-length(uv-vec2(0.,.05))*2.6);',
' o=vec4(col,1.);',
'}'
].join('\n');
const mist=new E.Pool(640);
const spark=new E.Pool(1024);
let prog=null;
const st={phase:0,timer:0,rise:0,frost:0,frostA:1,glowF:0,cryA:1,acc:0,acc2:0,acc3:0};
function baseY(){return E.H*(0.5-0.324);}
function mistFn(p,i,dt){
 p.size[i]+=26*dt*E.SC;
}
function snowFn(p,i,dt,t){
 p.vx[i]+=Math.sin(t*0.8+p.seed[i]*11)*18*dt*E.SC;
}
A.reg({
 id:'FX-104',name:'절대영도 거석',en:'Absolute Zero Monolith',
 desc:'5첨탑 빙정 대성당이 오로라 밤하늘 아래 탄성 융기. 내부 결정맥 필라멘트·동결광 기둥·무지개빛 프레넬 림, 융기 순간 빙편 90매 폭산. 서리맥 트윙클.',
 tech:['5-Spire SDF Cluster','Sphere-traced Skip March','Caustic Vein Filaments','Iridescent Fresnel Rim','Aurora Sky + Ice Shards'],
 bloom:0.85,
 init(){
  prog=E.U(E.mkProg(E.FS_VERT,FS,'FX104'),['uRes','uTime','uRise','uFrost','uFrostA','uGlowF','uCryA']);
 },
 reset(){
  mist.clear();spark.clear();
  st.phase=0;st.timer=0;st.rise=0;st.frost=0;st.frostA=1;st.glowF=0;st.cryA=1;
  st.acc=0;st.acc2=0;st.acc3=0;
 },
 autoPoint(){return [E.W*0.5,E.H*0.5];},
 trigger(){
  if(st.phase!==0)return;
  st.phase=1;st.timer=0;st.frostA=1;st.cryA=1;
  E.flashAdd(0.65,.7,1,1.2);E.shakeAdd(17*E.SC);E.setCA(0.006);
  const by=baseY();
  for(let i=0;i<90;i++){
   const a=Math.PI*0.5+E.rnd(-1.15,1.15);
   const sp=E.rnd(320,1150)*E.SC;
   spark.spawn(E.W*0.5+E.rnd(-55,55)*E.SC,by+E.rnd(-6,8)*E.SC,
    Math.cos(a)*sp,Math.sin(a)*sp,
    E.rnd(.8,1.7),E.rnd(6,19)*E.SC,.72,1.05,1.25,E.rnd(.6,.95),2,
    {rot:Math.random()*E.TAU,rv:E.rnd(-4,4),drag:1.1,grav:-1500*E.SC});
  }
  for(let i=0;i<110;i++){
   const s=Math.random()<0.5?-1:1;
   mist.spawn(E.W*0.5+E.rnd(0,60)*s*E.SC,by+E.rnd(-10,30)*E.SC,
    s*E.rnd(40,220)*E.SC,E.rnd(6,40)*E.SC,
    E.rnd(2.4,4.2),E.rnd(60,150)*E.SC,.55,.75,.85,E.rnd(.14,.3),3,
    {drag:.55,rot:Math.random()*E.TAU,rv:E.rnd(-.4,.4)});
  }
 },
 update(dt,t){
  st.timer+=dt;
  if(st.phase===0){
   st.acc3+=dt*13;
   while(st.acc3>1){
    st.acc3--;
    spark.spawn(E.rnd(0,E.W),E.H+10,E.rnd(-20,20),-E.rnd(28,75)*E.SC,
     E.rnd(6,11),E.rnd(2.5,6)*E.SC,.7,.9,1.1,E.rnd(.15,.4),0,{});
   }
   st.rise=Math.max(0,st.rise-dt*2);
   st.frost=Math.max(0,st.frost-dt*2);
   st.glowF=Math.max(0,st.glowF-dt*2);
  }else if(st.phase===1){
   const u=Math.min(1,st.timer/0.55);
   st.rise=u<1?E.easeOutBack(u):1;
   st.frost=E.easeOutCubic(Math.min(1,st.timer/2.0))*2.2;
   st.glowF=Math.max(0,1-st.timer/0.9);
   const by=baseY();
   if(st.timer<1.6){
    st.acc+=dt*60;
    while(st.acc>1){
     st.acc--;
     const s=Math.random()<0.5?-1:1;
     mist.spawn(E.W*0.5+E.rnd(20,120)*s*E.SC,by+E.rnd(-8,26)*E.SC,
      s*E.rnd(60,260)*E.SC,E.rnd(4,34)*E.SC,
      E.rnd(2.2,4),E.rnd(50,130)*E.SC,.55,.75,.85,E.rnd(.12,.26),3,
      {drag:.55,rot:Math.random()*E.TAU,rv:E.rnd(-.4,.4)});
    }
   }
   if(st.timer<3.4){
    st.acc2+=dt*34;
    while(st.acc2>1){
     st.acc2--;
     spark.spawn(E.W*0.5+E.rnd(-90,90)*E.SC,by+E.rnd(0,E.H*0.42),
      E.rnd(-25,25),E.rnd(10,60)*E.SC,
      E.rnd(.7,1.6),E.rnd(2.5,7)*E.SC,.8,1.1,1.3,E.rnd(.5,.9),0,{drag:.8});
    }
   }
   if(st.timer>4.6){st.phase=2;st.timer=0;}
  }else{
   const u=Math.min(1,st.timer/0.7);
   st.rise=1-E.easeOutCubic(u)*1;
   st.cryA=1-u*0.4;
   st.frostA=Math.max(0,1-u);
   st.glowF=0;
   if(u>=1){st.phase=0;st.timer=0;st.rise=0;st.frost=0;st.frostA=1;st.cryA=1;}
  }
  mist.update(dt,t,mistFn);
  spark.update(dt,t,snowFn);
 },
 drawField(t){
  if(!prog||!prog.p)return;
  const g=E.gl;
  g.useProgram(prog.p);
  g.uniform2f(prog.uRes,E.W,E.H);
  g.uniform1f(prog.uTime,t);
  g.uniform1f(prog.uRise,st.rise);
  g.uniform1f(prog.uFrost,st.frost);
  g.uniform1f(prog.uFrostA,st.frostA);
  g.uniform1f(prog.uGlowF,st.glowF);
  g.uniform1f(prog.uCryA,st.cryA);
  E.drawTri();
 },
 drawParticles(){
  E.drawPool(spark,E.ADD());
  E.drawPool(mist,E.ALPHA());
 },
 countParticles(){return mist.n+spark.n;}
});
})();
(function(){
"use strict";
const A=window.__ARC,E=A.env;
/* ambient: dark magitech indigo + faint arcane field */
const FS=[
'#version 300 es','precision highp float;',
'uniform vec2 uRes;uniform float uTime,uChg;',
'out vec4 o;',E.NOISE,
'void main(){',
' vec2 uv=gl_FragCoord.xy/uRes;',
' vec2 q=(gl_FragCoord.xy-uRes*.5)/uRes.y;',
' vec3 col=mix(vec3(.020,.016,.044),vec3(.006,.006,.018),uv.y);',
' float nb=fbm2(q*2.6+vec2(0.,-uTime*.04));',
' col+=vec3(.05,.035,.10)*nb*nb;',
/* faint hex arcane grid drift */
' float g=abs(sin(q.x*9.+uTime*.2))*abs(sin((q.x*.5+q.y*.87)*9.));',
' col+=vec3(.05,.07,.14)*smoothstep(.92,1.,g)*.25;',
/* central charge glow cyan-violet */
' col+=vec3(.30,.45,1.0)*uChg*exp(-length(q)*2.4)*.5;',
' o=vec4(col,1.);',
'}'
].join('\n');
/* custom magitech ribbon shader */
const RVS=[
'#version 300 es',
'layout(location=0) in vec2 aPos;layout(location=1) in vec2 aUV;layout(location=2) in float aFade;',
'uniform vec2 uRes;out vec2 vUV;out float vF;',
'void main(){gl_Position=vec4(aPos/uRes*2.-1.,0.,1.);vUV=aUV;vF=aFade;}'
].join('\n');
const RFS=[
'#version 300 es','precision highp float;',
'in vec2 vUV;in float vF;uniform float uTime;out vec4 o;',E.NOISE,
'void main(){',
' float v=vUV.y*2.-1.;float u=vUV.x;',
' float core=exp(-v*v*26.);',
' float edge=1.-smoothstep(.18,1.,abs(v));',
' float glyph=step(.55,fract(u*44.+vF*1.5))*smoothstep(.30,.85,abs(v));', /* etched runes along blade */
' float flick=.8+.3*n2(vec2(u*60.,uTime*11.));',
' vec3 c=mix(vec3(1.7,1.95,2.2),vec3(.55,.32,1.5),smoothstep(0.,.38,vF));',  /* white-cyan -> arcane violet */
' c=mix(c,vec3(1.45,.95,.35),smoothstep(.38,.92,vF));',                       /* -> gold ember decay */
' float a=(core*1.5+edge*.45)*(1.-smoothstep(.55,1.,vF))*flick;',
' c+=vec3(.7,.95,1.3)*core;',
' c+=vec3(1.0,.8,1.5)*glyph*edge*.55*(1.-smoothstep(.45,1.,vF));',
' o=vec4(c,a);',
'}'
].join('\n');
const SEG=46,MAXS=6,VPS=SEG*2,FPV=5;
const ember=new E.Pool(1600),smoke=new E.Pool(640);
let prog=null,rib=null,vbo=null,vao=null;
const verts=new Float32Array(MAXS*VPS*FPV);
const slots=[];
for(let s=0;s<MAXS;s++)slots.push({active:false,t0:0,seed:0,ang:0,
 bx:new Float32Array(SEG),by:new Float32Array(SEG),nx:new Float32Array(SEG),ny:new Float32Array(SEG),
 ox:new Float32Array(SEG),oy:new Float32Array(SEG)});
const queue=[];
const st={chg:0,timer:0,acc:0,cx:0,cy:0};
const DRAW_DUR=0.085,LIFE=1.9;
/* deliberate sealing composition: converging asterisk through the focal point */
const SLASHES=[{a:-0.42,d:0.00},{a:0.42,d:0.12},{a:Math.PI*0.5,d:0.24},{a:0.05,d:0.36},{a:-Math.PI*0.5+0.18,d:0.48}];
function spawnSlash(ang){
 let slot=null;for(const s of slots)if(!s.active){slot=s;break;}
 if(!slot)return;
 const L=Math.hypot(E.W,E.H)*0.62;
 const dx=Math.cos(ang),dy=Math.sin(ang),px=-dy,py=dx;
 const bow=0.12*L; /* consistent gentle arc */
 const p0=[st.cx-dx*L*0.5,st.cy-dy*L*0.5];
 const p2=[st.cx+dx*L*0.5,st.cy+dy*L*0.5];
 const p1=[(p0[0]+p2[0])*0.5+px*bow,(p0[1]+p2[1])*0.5+py*bow];
 for(let i=0;i<SEG;i++){const u=i/(SEG-1),w=1-u;
  slot.bx[i]=w*w*p0[0]+2*w*u*p1[0]+u*u*p2[0];
  slot.by[i]=w*w*p0[1]+2*w*u*p1[1]+u*u*p2[1];slot.ox[i]=0;slot.oy[i]=0;}
 for(let i=0;i<SEG;i++){const a=Math.max(0,i-1),b=Math.min(SEG-1,i+1);
  let tx=slot.bx[b]-slot.bx[a],ty=slot.by[b]-slot.by[a];const tl=Math.hypot(tx,ty)||1;
  slot.nx[i]=-ty/tl;slot.ny[i]=tx/tl;}
 slot.active=true;slot.t0=st.timer;slot.seed=Math.random()*100;slot.ang=ang;
 st.chg=Math.min(1.4,st.chg+0.5);
 E.flashAdd(0.34,.55,.7,1.0);E.shakeAdd(10*E.SC);E.setCA(0.005);
}
function widthCurve(a){return E.smoothstep(0,0.08,a)*(1-E.smoothstep(0.55,1,a));}
A.reg({
 id:'FX-108',name:'마법공학 봉인 참격',en:'Arcane-Tech Sealing Cleave',
 desc:'룬이 새겨진 백청 검기가 무작위가 아닌 의도된 봉인 별자리(수렴 애스터리스크)를 순차 작도. 코어는 백청 → 아케인 바이올렛 → 황금 잔광으로 식고, 칼날을 따라 각인 글리프가 명멸. 마법공학적 인디고 배경 + 헥사 아케인 그리드.',
 tech:['Deliberate Sealing Composition','Rune-Etched Blade Core','Cyan→Violet→Gold Grade','Glyph Flicker Along Edge','Custom Magitech Ribbon'],
 bloom:0.95,
 init(){const g=E.gl;
  prog=E.U(E.mkProg(E.FS_VERT,FS,'FX108'),['uRes','uTime','uChg']);
  rib=E.U(E.mkProg(RVS,RFS,'FX108r'),['uRes','uTime']);
  vbo=g.createBuffer();g.bindBuffer(g.ARRAY_BUFFER,vbo);g.bufferData(g.ARRAY_BUFFER,verts.byteLength,g.DYNAMIC_DRAW);
  vao=g.createVertexArray();g.bindVertexArray(vao);g.bindBuffer(g.ARRAY_BUFFER,vbo);
  g.enableVertexAttribArray(0);g.vertexAttribPointer(0,2,g.FLOAT,false,FPV*4,0);
  g.enableVertexAttribArray(1);g.vertexAttribPointer(1,2,g.FLOAT,false,FPV*4,8);
  g.enableVertexAttribArray(2);g.vertexAttribPointer(2,1,g.FLOAT,false,FPV*4,16);
  g.bindVertexArray(null);},
 reset(){ember.clear();smoke.clear();for(const s of slots)s.active=false;queue.length=0;st.chg=0;st.timer=0;st.acc=0;st.cx=E.W*0.5;st.cy=E.H*0.5;},
 autoPoint(){return [E.W*0.5,E.H*0.5];},
 resize(){},
 trigger(x,y){st.cx=x;st.cy=y;for(const sl of SLASHES)queue.push({d:sl.d,a:sl.a});},
 update(dt,t){
  st.timer+=dt;st.chg=Math.max(0,st.chg-dt*0.6);
  for(let i=queue.length-1;i>=0;i--){queue[i].d-=dt;if(queue[i].d<=0){spawnSlash(queue[i].a);queue.splice(i,1);}}
  for(const s of slots){if(!s.active)continue;const age=st.timer-s.t0;
   if(age>DRAW_DUR+LIFE){s.active=false;continue;}
   for(let i=0;i<SEG;i++){const u=i/(SEG-1);const segAge=E.clamp((age-u*DRAW_DUR)/LIFE,0,1);if(segAge<=0)continue;
    s.oy[i]+=(14+70*segAge)*dt*E.SC;s.ox[i]+=Math.sin(s.by[i]*0.012+t*2.+s.seed)*22*dt*E.SC;}
   if(age<DRAW_DUR){const hi=Math.min(SEG-1,Math.floor(age/DRAW_DUR*(SEG-1)));
    for(let k=0;k<6;k++)ember.spawn(s.bx[hi]+E.rnd(-5,5)*E.SC,s.by[hi]+E.rnd(-5,5)*E.SC,E.rnd(-150,150)*E.SC,E.rnd(-150,150)*E.SC,E.rnd(.1,.22),E.rnd(3,8)*E.SC,1.3,1.6,2.0,.95,0,{drag:5});}
   if(age<0.5){st.acc+=dt*70;while(st.acc>1){st.acc--;const i=Math.floor(E.rnd(0,SEG));
    ember.spawn(s.bx[i]+s.ox[i],s.by[i]+s.oy[i],E.rnd(-45,45)*E.SC,E.rnd(-30,90)*E.SC,E.rnd(.5,1.2),E.rnd(2,6)*E.SC,.7,.6,1.5,E.rnd(.5,.9),0,{drag:1.2,grav:30*E.SC});}}
   if(age>0.6&&age<1.6&&smoke.n<560){if(Math.random()<0.5){const i=Math.floor(E.rnd(0,SEG));
    smoke.spawn(s.bx[i]+s.ox[i],s.by[i]+s.oy[i],E.rnd(-18,18)*E.SC,E.rnd(10,50)*E.SC,E.rnd(1.4,2.6),E.rnd(40,95)*E.SC,.10,.08,.16,E.rnd(.2,.4),3,{drag:.7,rot:Math.random()*E.TAU,rv:E.rnd(-.5,.5)});}}
  }
  ember.update(dt,t,null);smoke.update(dt,t,null);
 },
 drawField(t){if(!prog||!prog.p)return;const g=E.gl;g.useProgram(prog.p);g.uniform2f(prog.uRes,E.W,E.H);g.uniform1f(prog.uTime,t);g.uniform1f(prog.uChg,Math.min(1,st.chg));E.drawTri();},
 drawParticles(t){const g=E.gl;const ranges=[];let vi=0;
  for(const s of slots){if(!s.active)continue;const age=st.timer-s.t0;const headT=E.clamp(age/DRAW_DUR,0,1);const start=vi/FPV;
   for(let i=0;i<SEG;i++){const u=i/(SEG-1);const segAge=E.clamp((age-u*DRAW_DUR)/LIFE,0,1);
    const px=s.bx[i]+s.ox[i],py=s.by[i]+s.oy[i];let w=0;
    if(u<=headT)w=26*E.SC*widthCurve(Math.max(segAge,0.001))*Math.pow(Math.sin(Math.PI*u),0.4);
    const nx=s.nx[i],ny=s.ny[i];
    verts[vi++]=px+nx*w;verts[vi++]=py+ny*w;verts[vi++]=u;verts[vi++]=0;verts[vi++]=segAge;
    verts[vi++]=px-nx*w;verts[vi++]=py-ny*w;verts[vi++]=u;verts[vi++]=1;verts[vi++]=segAge;}
   ranges.push({start,count:VPS});}
  if(ranges.length&&rib&&rib.p){g.useProgram(rib.p);g.uniform2f(rib.uRes,E.W,E.H);g.uniform1f(rib.uTime,t);
   g.blendFunc(g.SRC_ALPHA,g.ONE);g.bindVertexArray(vao);g.bindBuffer(g.ARRAY_BUFFER,vbo);
   g.bufferSubData(g.ARRAY_BUFFER,0,verts.subarray(0,vi));
   for(const r of ranges)g.drawArrays(g.TRIANGLE_STRIP,r.start,r.count);g.bindVertexArray(null);}
  E.drawPool(ember,E.ADD());E.drawPool(smoke,E.ALPHA());},
 countParticles(){let rib2=0;for(const s of slots)if(s.active)rib2+=SEG;return ember.n+smoke.n+rib2;}
});
})();
(function(){
"use strict";
const A=window.__ARC,E=A.env;
const FS=`#version 300 es
precision highp float;
out vec4 o;
uniform vec2 uRes; uniform float uTime,uPow,uFade;
float h2(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float n2(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(h2(i),h2(i+vec2(1,0)),f.x),mix(h2(i+vec2(0,1)),h2(i+vec2(1,1)),f.x),f.y); }
float fbm2(vec2 p){ float s=0.,a=.5; for(int i=0;i<5;i++){ s+=a*n2(p); p*=2.03; a*=.5; } return s; }
void main(){
  vec2 uv=(gl_FragCoord.xy/uRes)*2.-1.; uv.x*=uRes.x/uRes.y;
  float topd=clamp(1.-uv.y,0.,1.);
  vec3 col=vec3(0.02, 0.02+0.02*topd, 0.06+0.05*topd);
  float neb=fbm2(uv*1.2+vec2(3.,1.)); col+=vec3(0.05,0.0,0.07)*neb*neb;
  float sg=h2(floor(uv*120.)); float st=step(0.992,sg)*(0.5+0.5*sin(uTime*2.+sg*50.));
  col+=vec3(st);
  vec3 acol=vec3(0.);
  for(int L=0;L<3;L++){ float fL=float(L); float speed=0.05+0.03*fL;
    float warp=fbm2(vec2(uv.x*(1.+0.5*fL)+uTime*speed, uTime*0.07+fL));
    float xx=uv.x+(warp-0.5)*0.7;
    float baseY=-0.45+0.12*sin(xx*1.5+fL*2.+uTime*0.15)+(fbm2(vec2(xx*1.2,fL))-0.5)*0.25;
    float top=baseY+1.0+0.2*fL;
    float filament=fbm2(vec2(xx*11.+fL*5., uv.y*2.2-uTime*0.4));
    float band=smoothstep(baseY,baseY+0.06,uv.y)*(1.-smoothstep(baseY+0.25,top,uv.y));
    float streak=pow(clamp(filament,0.,1.),1.6);
    float I=band*streak;
    float hN=clamp((uv.y-baseY)/max(top-baseY,1e-3),0.,1.);
    vec3 c=mix(vec3(0.10,1.0,0.45),vec3(0.10,0.85,0.95),smoothstep(0.,0.5,hN));
    c=mix(c,vec3(0.65,0.25,1.0),smoothstep(0.5,1.,hN));
    acol+=c*I*(0.8-0.18*fL);
    float bgl=exp(-abs(uv.y-baseY)*12.)*streak*0.5;
    acol+=vec3(0.2,0.9,0.7)*bgl;
  }
  col+=acol*uPow;
  col+=(h2(uv*uRes.xy*0.7+uTime)-0.5)*0.012;
  col*=uFade;
  o=vec4(col,1.);
}`;
let prog=null; const st={t:0};
A.reg({
 id:'ARC-28',name:'오로라 천공막',en:'Aurora Veil',
 desc:'흐르는 반투명 오로라 커튼 — 도메인 워프 fbm 주름·수직 필라멘트 명멸·높이별 녹→청록→마젠타·성운·별·기저 발광선. substorm 호흡. 직선·가시 없는 유기적 천공.',
 tech:['Domain-Warp Curtains','Vertical Filaments','Height Color Ramp','Starfield+Nebula','Substorm Breathing'],bloom:1.0,
 init(){prog=E.U(E.mkProg(E.FS_VERT,FS,'ARC28'),['uRes','uTime','uPow','uFade']);},
 reset(){st.t=0;},
 resize(){},
 autoPoint(){return [E.W*0.5,E.H*0.5];},
 trigger(x,y){ st.t=0; },
 update(dt,t){st.t+=dt;},
 drawField(t){if(!prog||!prog.p)return;const g=E.gl;g.useProgram(prog.p);
  g.uniform2f(prog.uRes,E.W,E.H);g.uniform1f(prog.uTime,st.t);
  let fade=1;{const ph=st.t%16.0;if(ph<1.0)fade=E.smoothstep(0,1.0,ph);else if(ph>=14.0)fade=1-E.smoothstep(14.0,16.0,ph);}g.uniform1f(prog.uPow,0.55+0.45*Math.pow(0.5+0.5*Math.sin(st.t*0.55),2.0));g.uniform1f(prog.uFade,fade);
  E.drawTri();},
 drawParticles(){},
 countParticles(){return 0;}
});
})();
(function(){
"use strict";
const A=window.__ARC,E=A.env;
const FS=`#version 300 es
precision highp float;
out vec4 O;
uniform vec2 uRes; uniform float uTime, uFade;
const float PI=3.14159265359, TAU=6.28318530718;

float hh(float n){return fract(sin(n)*43758.5453);}
float hh2(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float nz(vec2 p){
  vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  return mix(mix(hh2(i),hh2(i+vec2(1,0)),f.x),mix(hh2(i+vec2(0,1)),hh2(i+vec2(1,1)),f.x),f.y);}
float fbm5(vec2 p){float s=0.,a=.5;for(int i=0;i<5;i++){s+=a*nz(p);p*=2.13;a*=.5;}return s;}

// Returns (perpendicular distance to bolt, endpoint mask) separately
// so we can build independent glow layers
vec2 boltInfo(vec2 p, vec2 a2, vec2 b2, float seed){
  vec2 d=b2-a2; float L=length(d); if(L<1e-4)return vec2(999.,0.);
  d/=L; vec2 n2=vec2(-d.y,d.x);
  float proj=clamp(dot(p-a2,d),0.,L);
  float nt=proj/L;
  float mask=smoothstep(0.,.06,nt)*smoothstep(0.,.06,1.-nt);
  float dp=(fbm5(vec2(nt*4.2+seed,seed*.7+uTime*.35))-0.5)*0.30*sin(nt*PI);
  dp+=(fbm5(vec2(nt*11.+seed*2.,seed+1.3))-0.5)*0.09*sin(nt*PI);
  float side=abs(dot(p-a2,n2)-dp);
  return vec2(side, mask);
}

// Signed distance to 6-pointed star (< 0 inside)
float star6SDF(vec2 p, float r){
  float a=atan(p.y,p.x);
  a=mod(a+PI/6.,PI/3.)-PI/6.;
  return length(p)*cos(a)/cos(PI/6.)-r;}

void main(){
  vec2 fc=(gl_FragCoord.xy/uRes)*2.-1.; fc.x*=uRes.x/uRes.y;
  vec3 ro=vec3(0.,2.2,-1.9), ta=vec3(0.,0.,.35);
  vec3 wF=normalize(ta-ro), wR=normalize(cross(vec3(0.,1.,0.),wF)), wU=normalize(cross(wF,wR));
  vec3 rd=normalize(wF+wR*fc.x*.82+wU*fc.y*.82);
  vec3 col=vec3(0.);

  // Global strike-flash intensity (sum of bolt activations)
  float totalAct=0.;
  for(int b=0;b<6;b++){ totalAct+=smoothstep(0.,.10,sin(uTime*1.9+float(b)*1.65)); }
  float flash=pow(clamp((totalAct-4.2)/1.0,0.,1.),3.);

  if(rd.y<-.001){
    float tg=-ro.y/rd.y;
    vec2 gp=(ro+rd*tg).xz;
    float gR=length(gp), gA=atan(gp.y,gp.x);

    // ── Cobblestone floor (very dark, precise tile lines) ──────────
    vec2 tv=fract(gp*3.)-.5;
    float tile=smoothstep(.44,.50,max(abs(tv.x),abs(tv.y)));
    float stone=fbm5(gp*2.1);
    col=vec3(.022,.028,.042)*(0.55+.30*tile+.15*stone);

    // Inner arena: selective blue underlighting only
    float inside=1.-smoothstep(.70,.95,gR);
    col+=vec3(.02,.06,.18)*inside*(0.5+.5*fbm5(gp*.9+uTime*.12))*.22;

    // ── RING — 3-layer crisp neon ───────────────────────────────────
    float rD=abs(gR-1.0);
    // L1 razor core: white-blue, ultra-tight
    col+=vec3(.78,.93,1.0)*exp(-rD*rD*11000.)*.86;
    // L2 neon halo: saturated blue
    col+=vec3(.22,.62,1.0)*exp(-rD*rD* 1100.)*.46;
    // L3 wide atmospheric: deep blue, soft
    col+=vec3(.05,.18,.62)*exp(-rD*rD*  75.)*.18;

    // Outer accent ring (precision thin)
    float rD2=abs(gR-1.09);
    col+=vec3(.68,.88,1.0)*exp(-rD2*rD2*18000.)*.85;
    col+=vec3(.18,.50,.90)*exp(-rD2*rD2* 2000.)*.45;

    // Rotating blade teeth (hard ornament spikes on ring)
    float teeth=pow(max(0.,cos(gA*12.-uTime*.55)),24.);
    float tR=abs(gR-1.175);
    col+=vec3(.32,.68,.96)*teeth*exp(-tR*tR*8000.)*.90;
    col+=vec3(.12,.40,.80)*teeth*exp(-tR*tR* 600.)*.40;

    // White shimmer barrier (FBM-animated)
    float bD=abs(gR-.965);
    float bShim=fbm5(vec2(gA*2.6,uTime*1.3));
    col+=vec3(.90,.96,1.0)*exp(-bD*bD*14000.)*bShim*.88;
    col+=vec3(.55,.78,1.0)*exp(-bD*bD* 1200.)*bShim*.42;

    // ── LIGHTNING — SDF-separated, 3 glow layers each bolt ─────────
    for(int b=0;b<6;b++){
      float ba=float(b)*(PI/3.)+hh(float(b)*5.7)*.4+uTime*.10;
      float act=smoothstep(0.,.10,sin(uTime*1.9+float(b)*1.65));
      float seed=float(b)*8.3+floor(uTime*.58)*1.3;
      vec2 bEnd=vec2(cos(ba),sin(ba));
      vec2 bi=boltInfo(gp,vec2(0.),bEnd,seed);
      float bd=bi.x, bm=bi.y*act;
      // L1 white core (ultra-sharp, ±1px)
      col+=vec3(.92,.97,1.0)*exp(-bd*bd*1600.)*bm*.85;
      // L2 blue neon mid-glow
      col+=vec3(.28,.65,1.0)*exp(-bd*bd* 230.)*bm*.50;
      // L3 wide blue ambient
      col+=vec3(.06,.20,.68)*exp(-bd*bd*  28.)*bm*.20;
      // Branch bolt (thinner, separate seed)
      vec2 bMid=bEnd*(0.40+hh(float(b)*2.1)*.20);
      float bba=ba+.80+hh(float(b)*4.)*.65-.33;
      vec2 bi2=boltInfo(gp,bMid,bMid+vec2(cos(bba),sin(bba))*.36,float(b)*6.1);
      float bd2=bi2.x, bm2=bi2.y*act;
      col+=vec3(.92,.82,1.0)*exp(-bd2*bd2*1400.)*bm2*.75;
      col+=vec3(.48,.20,1.0)*exp(-bd2*bd2* 200.)*bm2*.55;
    }

    // ── CRYSTAL BURSTS — rim-lit SDF edges ─────────────────────────
    for(int c=0;c<7;c++){
      float cf=float(c), cA2=cf*2.3996+uTime*.07;
      vec2 cPos=vec2(cos(cA2),sin(cA2))*(0.28+hh(cf*.7)*.60);
      float cPh=fract(uTime*.32+cf*.168), cSz=.038+cPh*.170;
      float sSDF=star6SDF(gp-cPos,cSz);
      float cAlpha=(1.-cPh)*smoothstep(.015,.06,cPh);
      // Crisp rim at boundary (energy outline)
      col+=vec3(.88,.97,1.0)*exp(-sSDF*sSDF*4500.)*cAlpha*.92;
      // Interior fill (slightly dimmer blue-white)
      col+=vec3(.48,.80,1.0)*max(0.,-sSDF/cSz)*.0*cAlpha; // placeholder
      col+=vec3(.40,.75,1.0)*clamp(-sSDF/cSz*.8,0.,1.)*cAlpha*.58;
      // Soft outer glow
      col+=vec3(.12,.40,.90)*exp(-max(sSDF,0.)*max(sSDF,0.)*280.)*cAlpha*.38;
      // Bright specular tip (occasional warm-gold accent)
      vec3 tipCol=mix(vec3(.96,.99,1.0),vec3(1.0,.90,.62),step(.5,fract(cf*.37+floor(uTime*.32)*.5)));
      col+=tipCol*exp(-sSDF*sSDF*28000.)*cAlpha*.95;
    }

    // ── SPARKS — two-layer bright dots ─────────────────────────────
    for(int s=0;s<26;s++){
      float sf=float(s), sph=fract(uTime*.52+sf*.081);
      float sang=sf*2.39996+uTime*.08;
      vec2 sp=vec2(cos(sang),sin(sang))*(0.06+sph*.84);
      vec2 dv=gp-sp; float dSq=dot(dv,dv);
      col+=vec3(.94,.97,1.0)*exp(-dSq*8500.)*(1.-sph)*.88;
      col+=vec3(.50,.78,1.0)*exp(-dSq* 900.)*(1.-sph)*.42;
    }

    col*=1.-smoothstep(1.55,2.90,gR); // ground fade
  } else {
    // ── Sky: dark, selective lightning ─────────────────────────────
    float hy=max(0.,-rd.y);
    col=vec3(.008,.009,.030)+vec3(.012,.028,.080)*pow(1.-hy,4.)*.50;
    for(int b=0;b<3;b++){
      float bx=float(b)*.090-.090;
      vec2 bi=boltInfo(fc,vec2(bx+hh(float(b)*.9)*.05,-.30),vec2(bx*.35,.88),float(b)*4.1+8.);
      float bd=bi.x, bm=bi.y;
      col+=vec3(.90,.95,1.0)*exp(-bd*bd*1400.)*bm*.85;
      col+=vec3(.22,.58,1.0)*exp(-bd*bd* 200.)*bm*.62;
    }
  }

  // ── CENTRAL ORB — 3-layer projection ───────────────────────────
  {vec3 oc=vec3(0.,.18,0.)-ro;
   vec3 wF2=normalize(ta-ro),wR2=normalize(cross(vec3(0.,1.,0.),wF2)),wU2=normalize(cross(wF2,wR2));
   float cz=dot(oc,wF2); vec2 os=vec2(dot(oc,wR2),dot(oc,wU2))/(cz*.82);
   float od=length(fc-os);
   col+=vec3(.98,.99,1.0)*exp(-od*od* 90.)*(.85+.15*flash); // white core
   col+=vec3(.68,.85,1.0)*exp(-od*od* 16.)*.70; // blue body
   col+=vec3(.22,.52,1.0)*exp(-od*od*  3.)*.40; // wide glow
  }

  // Whole-scene strike flash (rare, brief)
  col+=vec3(1.,.98,.94)*flash*.12;

  O=vec4(clamp(col*0.74,0.,1.)*uFade,1.);
}`;
let prog=null; const st={t:0};
A.reg({
 id:'ARC-31',name:'뇌격 결계 (3D 바닥)',en:'Thunder Rite (3D Floor)',
 desc:'3D 투시 코블스톤 바닥에 6각성 룬 성진이 새겨지고 FBM 뇌격이 내리꽂히는 결계. REF-01 구버전의 3D 바닥 연출(평면 라디얼 ARC-26과 별도 항목).',
 tech:['3D Cobblestone Floor','Hexagram Rune Sigil','FBM Lightning','Crystal Burst'],bloom:0.95,
 init(){prog=E.U(E.mkProg(E.FS_VERT,FS,'ARC31'),['uRes','uTime','uFade']);},
 reset(){st.t=0;}, resize(){},
 autoPoint(){return [E.W*0.5,E.H*0.5];},
 trigger(x,y){st.t=0;},
 update(dt,t){st.t+=dt;},
 drawField(t){if(!prog||!prog.p)return;const g=E.gl;g.useProgram(prog.p);
  g.uniform2f(prog.uRes,E.W,E.H);g.uniform1f(prog.uTime,st.t);
  const P=14.0,ph=st.t%P;const fade=E.smoothstep(0,2.5,ph)*(1-E.smoothstep(12,14,ph));g.uniform1f(prog.uFade,fade);
  E.drawTri();},
 drawParticles(){}, countParticles(){return 0;}
});
})();

/* ===== [2] arc 브릿지 ===== */
/* ════════════════════════════════════════════════════════════════
   vfx-arc-bridge.js ── arcanum WebGL2 엔진 → 월드좌표 additive 스프라이트
   의존: window.__ARC (vfx-arcanum-engine.js, 먼저 로드) + three(importmap)
   원리: 오프스크린 webgl2 → CanvasTexture → THREE.Sprite(Additive)
        엔진 clearColor=검정 ∴ 가산합성 시 배경 투명, 효과만 발광
   제약: 엔진 1컨텍스트 = 동시 1효과. 신규 spawn은 이전 스프라이트 대체.
        (동시 다중 arcanum 필요 시 엔진 인스턴스 다중화 — 차후)
   ════════════════════════════════════════════════════════════════ */
'use strict';


export class VFXArcBridge {
  /**
   * @param {THREE.Scene}  scene
   * @param {THREE.Camera} camera
   * @param {object} opts  { size=512 }
   */
  constructor(scene, camera, opts = {}) {
    this.scene  = scene;
    this.camera = camera;
    this.size   = opts.size || 512;
    this.ready  = false;

    // 오프스크린 webgl2 canvas (DOM 미부착, 명시 크기 → resize 헤드리스 분기)
    this.off = document.createElement('canvas');
    this.off.width = this.off.height = this.size;

    if (typeof window !== 'undefined' && window.__ARC) {
      try { this.ready = window.__ARC.bootHeadless(this.off); }
      catch (e) { console.error('[VFXArcBridge] bootHeadless 실패:', e); }
    } else {
      console.warn('[VFXArcBridge] window.__ARC 없음 — vfx-arcanum-engine.js 먼저 로드');
    }

    // 단일 공유 텍스처 (엔진이 1효과만 렌더 ∴ 텍스처도 1개)
    this.tex = new THREE.CanvasTexture(this.off);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.minFilter  = THREE.LinearFilter;
    this.tex.generateMipmaps = false;

    this._active = null;   // { sprite, born, ttl, fade }
    this._idCache = this.ready ? new Set(window.__ARC.idList()) : new Set();
  }

  has(id) { return this._idCache.has(id); }
  ids()   { return [...this._idCache]; }

  /**
   * 월드좌표에 arcanum 효과 1개 발생 (이전 활성효과 대체).
   * @param {string} id        효과 id (예 'FX-89')
   * @param {THREE.Vector3} worldPos
   * @param {object} opts  { scale=6, ttl=1800, fade=0.3, fireX, fireY }
   */
  spawnAtWorld(id, worldPos, opts = {}) {
    if (!this.ready) return null;
    if (!this._idCache.has(id)) { console.warn('[VFXArcBridge] 미등록 효과:', id); return null; }

    // 엔진 효과 전환 + 트리거 (캔버스 중앙 = 스프라이트 중심)
    window.__ARC.select(id);
    const fx = opts.fireX != null ? opts.fireX : this.size * 0.5;
    const fy = opts.fireY != null ? opts.fireY : this.size * 0.5;
    window.__ARC.fire(fx, fy);

    // 이전 스프라이트 제거 (단일활성)
    if (this._active) this._disposeActive();

    const mat = new THREE.SpriteMaterial({
      map: this.tex,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,   // 가산효과는 깊이쓰기 X
      depthTest:  true,
      opacity: 1,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.position.copy(worldPos);
    const s = opts.scale || 6;
    sprite.scale.set(s, s, 1);
    this.scene.add(sprite);

    this._active = {
      sprite,
      born: performance.now(),
      ttl:  opts.ttl  != null ? opts.ttl  : 1800,
      fade: opts.fade != null ? opts.fade : 0.3,
    };
    return this._active;
  }

  /** 게임 animate() 매 프레임 호출 */
  update() {
    if (!this.ready) return;

    // 엔진 1프레임 펌프 → 오프스크린 갱신 → 텍스처 업로드
    window.__ARC.pump(performance.now());
    this.tex.needsUpdate = true;

    const a = this._active;
    if (!a) return;
    const age = performance.now() - a.born;
    if (age >= a.ttl) { this._disposeActive(); return; }

    // 말기 fade-out
    const k = age / a.ttl;
    const fs = 1 - a.fade;
    a.sprite.material.opacity = k < fs ? 1 : Math.max(0, 1 - (k - fs) / a.fade);
  }

  _disposeActive() {
    const a = this._active; if (!a) return;
    this.scene.remove(a.sprite);
    a.sprite.material.dispose();   // 텍스처는 공유 ∴ dispose 안 함
    this._active = null;
  }

  dispose() {
    this._disposeActive();
    this.tex.dispose();
    this.ready = false;
  }
}
