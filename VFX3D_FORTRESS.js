/* ================================================================
   VFX3D_FORTRESS.js  v1.0
   GlobeStriker Fortress Mode — 3D Particle VFX
   Ported from vfx(투사체).html  (Canvas 2D → Three.js BufferGeometry)

   24 types: eth elc wnd neg fir ice poi tim rok snd
             ert dkf irn wod wat hol drg sol arc dim
             stm dat pla chs

   Requires: THREE.js r128+
   ================================================================

   COORDINATE NOTES
   ─────────────────
   2D source: Y+ = down, gravity positive = falling
   3D target:  Y+ = up,  gravity negative = falling
   ∴ vel.y  -= gy_2d * S * dt   (positive gy_2d → falls → -Y in 3D)
   ∴ upward bias (fire) = +Y in 3D
   ∴ vyBias_2d negative → upward → negate when applied to vel.y

   SCALE
   ─────
   FORT_SCALE (S) = 2D pixel → 3D world unit multiplier.
   Default 0.015 (100px ≈ 1.5 world units).
   Tune to match your Fortress world size.
   ================================================================ */

'use strict';

import * as THREE from 'three';   // [ESM] module-scoped THREE (importmap)

/* ── Tunables ─────────────────────────────────────────────────── */
const FORT_SCALE  = 0.015;   // px → world unit (tune per scene)
const MAX_P       = 200;     // max particles per instance
const PT_SCALE    = 300.0;   // depth-attenuation constant (vertex shader)

/* ── HSL → RGB helper ─────────────────────────────────────────── */
function _hsl(h, s, l) {
  const a = s * Math.min(l, 1 - l);
  const f = n => { const k = (n + h * 12) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
  return [f(0), f(8), f(4)];
}

/* ── Shared ShaderMaterial (per-vertex size + alpha + soft disc) ─
   Bug fix vs PointsMaterial: PointsMaterial has no per-vertex size.
   ShaderMaterial lets dead particles have sz=0 (invisible).        */
let _sharedMat = null;
function _getMat() {
  if (_sharedMat) return _sharedMat;
  _sharedMat = new THREE.ShaderMaterial({
    vertexShader: `
      attribute float pSz;
      attribute float pA;
      attribute vec3  pCol;
      varying   vec3  vCol;
      varying   float vA;
      void main(){
        vCol = pCol;
        vA   = pA;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = pSz * ${PT_SCALE.toFixed(1)} / -mv.z;
        gl_Position  = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      varying vec3  vCol;
      varying float vA;
      void main(){
        vec2  c = gl_PointCoord - 0.5;
        float d = dot(c, c);
        if(d > 0.25) discard;
        float f = 1.0 - smoothstep(0.10, 0.25, d);
        gl_FragColor = vec4(vCol, vA * f);
      }
    `,
    transparent: true,
    depthWrite:  false,
    blending:    THREE.AdditiveBlending
  });
  return _sharedMat;
}

/* ═══════════════════════════════════════════════════════════════
   DATA CATALOG  —  extracted + normalized from 2D source
   ═══════════════════════════════════════════════════════════════
   c1 / c2  : RGB [0–1] float arrays   (null → rainbow / chaos)
   split     : probability of c1 vs c2  (default 0.5)
   sz        : base particle world size
   tr        : trail emitter params     (2D px, converted via S)
   bu        : burst params             (2D px speed)
   ph        : physics params
     tDec      trail life decay rate (/s)
     tDecMn/Mx  randomised decay range (fire / dkf / drg)
     tDrg      trail velocity drag (/s)
     tDrgX/Y   asymmetric drag X / Y   (fire / dkf / drg)
     bDec      burst life decay rate
     bDrg      burst velocity drag
     gy        gravity (2D convention: positive = falling down)
     gyT / gyB separate gravity for trail / burst
     sineX     true → add sinusoidal X + Z acceleration (chaos / fire etc.)
     sineFreq / sineAmp   sinusoidal params
   upward    : trail gets +Y launch bias (fire / stm / drg etc.)
   spark     : emit from exact pos with high-random vel (elc / irn)
   crystal   : ice style — slow drift, sparkle fade
   chaos     : per-particle hue shifts every frame
   rainbow   : random hue on spawn, constant thereafter
   ═══════════════════════════════════════════════════════════════ */
const VFX3D_DATA = {

  /* ── 1. ETH 에테르 ────────────────────────────────────────── */
  eth:{ label:'에테르',
    c1:[0.243,0.910,1.000], c2:[0.753,0.518,0.988], split:0.55,
    NT:200, NB:65, SPD:380, sz:0.10,
    tr:{ n:2, sp:13, tvR:22, rMn:3, rMx:11, life:1.0 },
    bu:{ mn:90,  mx:240, vyBias:0 },
    ph:{ tDec:1.35, tDrg:2.8, bDec:1.1, bDrg:1.8, gy:0 } },

  /* ── 2. ELC 전기 ──────────────────────────────────────────── */
  elc:{ label:'전기',
    c1:[0.243,0.910,1.000], c2:[0.486,0.227,0.929], spark:true,
    NT:160, NB:65, SPD:600, sz:0.055,
    tr:{ n:4, sp:0, tvR:180, rMn:1, rMx:1, life:0.32 },
    bu:{ mn:130, mx:320, vyBias:0 },
    ph:{ tDec:4.5, tDrg:1.4, bDec:1.8, bDrg:1.8, gy:40 } },

  /* ── 3. WND 바람 ──────────────────────────────────────────── */
  wnd:{ label:'바람',
    c1:[0.498,1.000,0.831], c2:[1.000,1.000,1.000],
    NT:150, NB:65, SPD:350, sz:0.09,
    tr:{ n:2, sp:18, tvR:35, rMn:2, rMx:7, life:1.0 },
    bu:{ mn:70,  mx:200, vyBias:0 },
    ph:{ tDec:1.45, tDrg:2.2, bDec:1.0, bDrg:1.8, gy:0 } },

  /* ── 4. NEG 음에너지 ──────────────────────────────────────── */
  neg:{ label:'음에너지',
    c1:[0.600,0.000,0.800], c2:[1.000,0.133,0.333],
    NT:140, NB:65, SPD:320, sz:0.09,
    tr:{ n:2, sp:14, tvR:28, rMn:2, rMx:9, life:0.9 },
    bu:{ mn:50,  mx:220, vyBias:0 },
    ph:{ tDec:1.1, tDrg:1.5, bDec:0.85, bDrg:1.5, gy:0 } },

  /* ── 5. FIR 불꽃 ──────────────────────────────────────────── */
  fir:{ label:'불꽃',
    c1:[1.000,0.533,0.063], c2:[1.000,0.933,0.267], upward:true,
    NT:180, NB:65, SPD:420, sz:0.10,
    tr:{ n:4, sp:10, tvR:32, rMn:2, rMx:10, life:1.0 },
    bu:{ mn:120, mx:280, vyBias:-70 },
    ph:{ tDecMn:1.1, tDecMx:1.5, tDrgX:2.2, tDrgY:0.5,
         bDec:1.0, bDrg:1.5, gyT:-10, gyB:-20,
         sineX:true, sineFreq:6.5, sineAmp:26 } },

  /* ── 6. ICE 얼음 ──────────────────────────────────────────── */
  ice:{ label:'얼음',
    c1:[0.400,0.800,1.000], c2:[0.800,0.941,1.000], crystal:true,
    NT:120, NB:65, SPD:340, sz:0.08,
    tr:{ n:2, sp:12, tvR:10, rMn:3, rMx:10, life:1.2 },
    bu:{ mn:90,  mx:240, vyBias:0 },
    ph:{ tDec:0.85, tDrg:4.0, bDec:1.05, bDrg:1.5, gy:0 } },

  /* ── 7. POI 독 ─────────────────────────────────────────────── */
  poi:{ label:'독',
    c1:[0.267,1.000,0.400], c2:[0.200,1.000,0.333],
    NT:150, NB:65, SPD:340, sz:0.08,
    tr:{ n:3, sp:10, tvR:16, rMn:2, rMx:7, life:1.0 },
    bu:{ mn:80,  mx:200, vyBias:0 },
    ph:{ tDec:1.1, tDrg:2.5, bDec:0.95, bDrg:1.6, gy:72,
         sineX:true, sineFreq:4.0, sineAmp:10 } },

  /* ── 8. TIM 시간 ──────────────────────────────────────────── */
  tim:{ label:'시간',
    c1:[1.000,0.843,0.000], c2:[0.753,0.753,0.753],
    NT:120, NB:65, SPD:360, sz:0.08,
    tr:{ n:2, sp:8,  tvR:16, rMn:2, rMx:6, life:1.0 },
    bu:{ mn:60,  mx:180, vyBias:0 },
    ph:{ tDec:1.0, tDrg:1.5, bDec:1.0, bDrg:1.5, gy:0 } },

  /* ── 9. ROK 바위 ──────────────────────────────────────────── */
  rok:{ label:'바위',
    c1:[0.667,0.627,0.533], c2:[0.600,0.565,0.467],
    NT:100, NB:55, SPD:300, sz:0.13,
    tr:{ n:2, sp:12, tvR:40, rMn:3, rMx:10, life:1.1 },
    bu:{ mn:90,  mx:210, vyBias:0 },
    ph:{ tDec:0.9, tDrg:1.4, bDec:0.85, bDrg:1.2, gy:160 } },

  /* ── 10. SND 모래 ─────────────────────────────────────────── */
  snd:{ label:'모래',
    c1:[0.910,0.753,0.267], c2:[0.784,0.596,0.188],
    NT:200, NB:65, SPD:380, sz:0.06,
    tr:{ n:6, sp:10, tvR:50, rMn:1, rMx:3, life:0.7 },
    bu:{ mn:110, mx:260, vyBias:0 },
    ph:{ tDec:2.2, tDrg:3.0, bDec:1.2, bDrg:1.5, gy:20 } },

  /* ── 11. ERT 흙 ───────────────────────────────────────────── */
  ert:{ label:'흙',
    c1:[0.420,0.251,0.149], c2:[0.290,0.176,0.078],
    NT:150, NB:60, SPD:310, sz:0.10,
    tr:{ n:2, sp:10, tvR:28, rMn:2, rMx:8, life:1.1 },
    bu:{ mn:90,  mx:210, vyBias:-80 },
    ph:{ tDec:1.05, tDrg:2.0, bDec:0.92, bDrg:1.3, gy:125 } },

  /* ── 12. DKF 흑염 ─────────────────────────────────────────── */
  dkf:{ label:'흑염',
    c1:[0.533,0.000,0.533], c2:[0.800,0.267,0.800], downward:true,
    NT:160, NB:60, SPD:350, sz:0.10,
    tr:{ n:4, sp:12, tvR:28, rMn:2, rMx:9, life:1.0 },
    bu:{ mn:100, mx:230, vyBias:55 },
    ph:{ tDecMn:1.1, tDecMx:1.5, tDrgX:2.0, tDrgY:0.48,
         bDec:0.95, bDrg:1.5, gyT:14, gyB:42,
         sineX:true, sineFreq:6.5, sineAmp:26 } },

  /* ── 13. IRN 쇠 ───────────────────────────────────────────── */
  irn:{ label:'쇠',
    c1:[0.784,0.784,0.784], c2:[1.000,0.867,0.267], spark:true,
    NT:130, NB:60, SPD:580, sz:0.055,
    tr:{ n:4, sp:0, tvR:160, rMn:1, rMx:1, life:0.25 },
    bu:{ mn:160, mx:320, vyBias:0 },
    ph:{ tDec:5.0, tDrg:1.4, bDec:2.2, bDrg:2.0, gy:42 } },

  /* ── 14. WOD 나무 ─────────────────────────────────────────── */
  wod:{ label:'나무',
    c1:[0.267,0.800,0.133], c2:[0.667,0.867,0.267],
    NT:100, NB:60, SPD:300, sz:0.10,
    tr:{ n:2, sp:12, tvR:26, rMn:3, rMx:9, life:1.2 },
    bu:{ mn:75,  mx:200, vyBias:0 },
    ph:{ tDec:0.82, tDrg:2.0, bDec:0.92, bDrg:1.6, gy:36,
         sineX:true, sineFreq:3.0, sineAmp:13 } },

  /* ── 15. WAT 물 ───────────────────────────────────────────── */
  wat:{ label:'물',
    c1:[0.267,0.667,1.000], c2:[0.400,0.733,1.000],
    NT:150, NB:65, SPD:350, sz:0.09,
    tr:{ n:3, sp:10, tvR:24, rMn:2, rMx:7, life:1.0 },
    bu:{ mn:100, mx:230, vyBias:0 },
    ph:{ tDec:1.1, tDrg:2.5, bDec:1.0, bDrg:1.5, gy:55 } },

  /* ── 16. HOL 신성 ─────────────────────────────────────────── */
  hol:{ label:'신성',
    c1:[1.000,0.933,0.400], c2:[1.000,1.000,1.000], split:0.4,
    NT:100, NB:65, SPD:400, sz:0.09,
    tr:{ n:2, sp:10, tvR:16, rMn:2, rMx:7, life:1.0, upBias:20 },
    bu:{ mn:90,  mx:220, vyBias:0 },
    ph:{ tDec:1.0, tDrg:2.5, bDec:1.1, bDrg:1.4, gy:0 } },

  /* ── 17. DRG 용염 ─────────────────────────────────────────── */
  drg:{ label:'용염',
    c1:[1.000,0.533,0.267], c2:[1.000,0.800,0.400], upward:true,
    NT:170, NB:65, SPD:420, sz:0.10,
    tr:{ n:4, sp:10, tvR:32, rMn:2, rMx:10, life:1.0 },
    bu:{ mn:110, mx:260, vyBias:0 },
    ph:{ tDecMn:1.15, tDecMx:1.4, tDrgX:2.2, tDrgY:0.5,
         bDec:1.0, bDrg:1.5, gyT:-8, gyB:-10,
         sineX:true, sineFreq:5.0, sineAmp:22 } },

  /* ── 18. SOL 영혼 ─────────────────────────────────────────── */
  sol:{ label:'영혼',
    c1:[0.667,0.733,1.000], c2:[0.800,0.867,1.000], split:0.55,
    NT:130, NB:65, SPD:300, sz:0.12,
    tr:{ n:2, sp:11, tvR:18, rMn:4, rMx:12, life:1.3 },
    bu:{ mn:70,  mx:180, vyBias:0 },
    ph:{ tDec:0.75, tDrg:2.0, bDec:0.70, bDrg:1.5, gy:0,
         sineX:true, sineFreq:2.5, sineAmp:12 } },

  /* ── 19. ARC 비전 ─────────────────────────────────────────── */
  arc:{ label:'비전',
    c1:null, c2:null, rainbow:true,
    NT:120, NB:65, SPD:380, sz:0.08,
    tr:{ n:3, sp:12, tvR:38, rMn:1, rMx:6, life:0.9 },
    bu:{ mn:90,  mx:230, vyBias:0 },
    ph:{ tDec:1.8, tDrg:2.5, bDec:1.0, bDrg:1.6, gy:0 } },

  /* ── 20. DIM 차원 ─────────────────────────────────────────── */
  dim:{ label:'차원',
    c1:[1.000,0.267,1.000], c2:[0.533,0.000,0.800], split:0.5,
    NT:80,  NB:65, SPD:320, sz:0.09,
    tr:{ n:2, sp:10, tvR:20, rMn:2, rMx:8, life:1.2 },
    bu:{ mn:80,  mx:200, vyBias:0 },
    ph:{ tDec:0.85, tDrg:1.4, bDec:0.85, bDrg:1.4, gy:0 } },

  /* ── 21. STM 증기 ─────────────────────────────────────────── */
  stm:{ label:'증기',
    c1:[0.816,0.780,0.784], c2:[0.831,0.659,0.376], upward:true,
    NT:90,  NB:60, SPD:440, sz:0.12,
    tr:{ n:2, sp:12, tvR:18, rMn:4, rMx:14, life:1.4 },
    bu:{ mn:100, mx:240, vyBias:0 },
    ph:{ tDec:0.7, tDrg:1.5, bDec:1.0, bDrg:1.5, gy:-8 } },

  /* ── 22. DAT 데이터 ───────────────────────────────────────── */
  dat:{ label:'데이터',
    c1:[0.000,1.000,0.267], c2:[0.000,0.800,0.133],
    NT:180, NB:65, SPD:700, sz:0.055,
    tr:{ n:5, sp:10, tvR:55, rMn:1, rMx:3, life:0.65 },
    bu:{ mn:150, mx:300, vyBias:0 },
    ph:{ tDec:2.5, tDrg:3.0, bDec:1.5, bDrg:1.8, gy:0 } },

  /* ── 23. PLA 플라즈마 ─────────────────────────────────────── */
  pla:{ label:'플라즈마',
    c1:[1.000,0.533,1.000], c2:[0.533,1.000,1.000], split:0.5,
    NT:170, NB:65, SPD:450, sz:0.09,
    tr:{ n:4, sp:12, tvR:42, rMn:2, rMx:8, life:1.0 },
    bu:{ mn:120, mx:280, vyBias:0 },
    ph:{ tDec:1.3, tDrg:2.2, bDec:1.1, bDrg:1.6, gy:0 } },

  /* ── 24. CHS 혼돈 ─────────────────────────────────────────── */
  chs:{ label:'혼돈',
    c1:null, c2:null, rainbow:true, chaos:true,
    NT:200, NB:65, SPD:400, sz:0.10,
    tr:{ n:5, sp:12, tvR:52, rMn:2, rMx:8, life:1.0 },
    bu:{ mn:80,  mx:260, vyBias:0 },
    ph:{ tDec:1.5, tDrg:2.5, bDec:1.0, bDrg:1.5, gy:0,
         sineX:true, sineFreq:7.0, sineAmp:180 } },
};

/* ═══════════════════════════════════════════════════════════════
   VFX3DParticles  —  Base class (handles 19 of 24 types)
   Subclasses override emitTrail() and/or update() where needed.
   ═══════════════════════════════════════════════════════════════ */
class VFX3DParticles {
  constructor(type, scene) {
    const d = VFX3D_DATA[type];
    if (!d) throw new Error(`VFX3D: unknown type "${type}"`);
    this.data  = d;
    this.type  = type;
    this._T    = 0;
    this._ptr  = 0;  // ring-buffer write head

    /* ── CPU-side particle state ───────────────────────────── */
    this._pos  = new Float32Array(MAX_P * 3); // x,y,z
    this._vel  = new Float32Array(MAX_P * 3); // vx,vy,vz
    this._col  = new Float32Array(MAX_P * 3); // base RGB
    this._life = new Float32Array(MAX_P);
    this._maxL = new Float32Array(MAX_P);
    this._sz   = new Float32Array(MAX_P);
    this._hue  = new Float32Array(MAX_P);     // rainbow / chaos
    this._pha  = new Float32Array(MAX_P);     // sinusoidal phase
    this._idx  = new Uint8Array(MAX_P);       // 1 = burst particle

    /* ── GPU write buffers (compacted alive-particle data) ──── */
    this._gPos = new Float32Array(MAX_P * 3);
    this._gCol = new Float32Array(MAX_P * 3);
    this._gSz  = new Float32Array(MAX_P);
    this._gA   = new Float32Array(MAX_P);

    /* ── Three.js geometry ───────────────────────────────────── */
    this._geom = new THREE.BufferGeometry();
    const DU   = THREE.DynamicDrawUsage;
    this._geom.setAttribute('position', new THREE.BufferAttribute(this._gPos, 3).setUsage(DU));
    this._geom.setAttribute('pCol',     new THREE.BufferAttribute(this._gCol, 3).setUsage(DU));
    this._geom.setAttribute('pSz',      new THREE.BufferAttribute(this._gSz,  1).setUsage(DU));
    this._geom.setAttribute('pA',       new THREE.BufferAttribute(this._gA,   1).setUsage(DU));
    this._geom.setDrawRange(0, 0);

    this._pts = new THREE.Points(this._geom, _getMat());
    this._pts.frustumCulled = false;
    scene.add(this._pts);
  }

  /* ── Slot allocator (ring buffer — overwrites oldest) ──────── */
  _alloc() {
    const i  = this._ptr;
    this._ptr = (this._ptr + 1) % MAX_P;
    return i;
  }

  /* ── Pick color for slot i from data config ─────────────────── */
  _col3(i) {
    const d = this.data;
    if (d.rainbow || d.chaos) {
      const h = Math.random();
      this._hue[i] = h;
      const [r, g, b] = _hsl(h, 1.0, 0.7);
      this._col[i*3] = r; this._col[i*3+1] = g; this._col[i*3+2] = b;
    } else if (d.c1 && d.c2) {
      const c = Math.random() < (d.split ?? 0.5) ? d.c1 : d.c2;
      this._col[i*3] = c[0]; this._col[i*3+1] = c[1]; this._col[i*3+2] = c[2];
    } else if (d.c1) {
      this._col[i*3] = d.c1[0]; this._col[i*3+1] = d.c1[1]; this._col[i*3+2] = d.c1[2];
    }
  }

  /* ── Trail emitter ─────────────────────────────────────────── */
  emitTrail(origin, dir) {
    const d = this.data, S = FORT_SCALE;
    for (let e = 0; e < d.tr.n; e++) {
      const i   = this._alloc();
      // 3D spherical spread (more natural than 2D disc in 3D space)
      const sp  = (0.4 + Math.random() * 0.6) * d.tr.sp * S;
      const ang = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      this._pos[i*3]   = origin.x + Math.sin(phi) * Math.cos(ang) * sp;
      this._pos[i*3+1] = origin.y + Math.cos(phi) * sp;
      this._pos[i*3+2] = origin.z + Math.sin(phi) * Math.sin(ang) * sp;
      // Random velocity
      const tv = d.tr.tvR * S;
      this._vel[i*3]   = (Math.random() - 0.5) * tv;
      this._vel[i*3+1] = (Math.random() - 0.5) * tv;
      this._vel[i*3+2] = (Math.random() - 0.5) * tv;
      // Upward bias (hol)
      if (d.tr.upBias) this._vel[i*3+1] += d.tr.upBias * S;
      // Sinusoidal phase seed
      this._pha[i] = Math.random() * Math.PI * 2;
      // Size, life, color
      this._sz[i]   = (d.tr.rMn + Math.random() * (d.tr.rMx - d.tr.rMn)) * S * 0.5;
      const l       = d.tr.life ?? 1.0;
      this._life[i] = l;
      this._maxL[i] = l;
      this._idx[i]  = 0;
      this._col3(i);
    }
  }

  /* ── Burst emitter (spherical explosion) ───────────────────── */
  burst(center) {
    const d = this.data, S = FORT_SCALE;
    for (let e = 0; e < d.NB; e++) {
      const i   = this._alloc();
      const phi = Math.acos(2 * Math.random() - 1);
      const ang = Math.random() * Math.PI * 2;
      const spd = (d.bu.mn + Math.random() * (d.bu.mx - d.bu.mn)) * S;
      this._pos[i*3]   = center.x + (Math.random() - 0.5) * 0.25;
      this._pos[i*3+1] = center.y + (Math.random() - 0.5) * 0.25;
      this._pos[i*3+2] = center.z + (Math.random() - 0.5) * 0.25;
      this._vel[i*3]   = Math.sin(phi) * Math.cos(ang) * spd;
      this._vel[i*3+1] = Math.cos(phi) * spd;
      this._vel[i*3+2] = Math.sin(phi) * Math.sin(ang) * spd;
      // vyBias: 2D negative = upward → 3D positive Y; negate sign
      this._vel[i*3+1] -= (d.bu.vyBias ?? 0) * S;
      const l          = 0.6 + Math.random() * 0.4;
      this._life[i]    = l;
      this._maxL[i]    = l;
      this._sz[i]      = d.sz * (0.6 + Math.random() * 0.9);
      this._pha[i]     = Math.random() * Math.PI * 2;
      this._idx[i]     = 1;
      this._col3(i);
    }
  }

  /* ── Per-frame update ──────────────────────────────────────── */
  update(dt) {
    this._T += dt;
    const d = this.data, S = FORT_SCALE;
    const ph = d.ph;

    /* ── Physics ─────────────────────────────────────────────── */
    for (let i = 0; i < MAX_P; i++) {
      if (this._life[i] <= 0) continue;
      const iB = this._idx[i];

      // Life decay (with optional random range for fire/dkf/drg)
      let dec;
      if (!iB && ph.tDecMn !== undefined) {
        dec = ph.tDecMn + Math.random() * (ph.tDecMx - ph.tDecMn);
      } else {
        dec = iB ? (ph.bDec ?? 1.0) : (ph.tDec ?? 1.0);
      }
      this._life[i] -= dt * dec;
      if (this._life[i] <= 0) { this._life[i] = 0; continue; }

      // Drag (asymmetric X/Z vs Y for fire/dkf/drg)
      const dX = iB ? (ph.bDrg ?? 1.5)  : (ph.tDrgX ?? ph.tDrg ?? 2.0);
      const dY = iB ? (ph.bDrg ?? 1.5)  : (ph.tDrgY ?? ph.tDrg ?? 2.0);
      this._vel[i*3]   *= (1 - dt * dX);
      this._vel[i*3+1] *= (1 - dt * dY);
      this._vel[i*3+2] *= (1 - dt * dX);

      // Gravity (2D positive = falling → 3D negate → -Y)
      const gy = (iB ? (ph.gyB ?? ph.gy ?? 0) : (ph.gyT ?? ph.gy ?? 0)) * S;
      this._vel[i*3+1] -= gy * dt;

      // Sinusoidal X + Z acceleration (fire / chaos / poi / sol / wod)
      if (!iB && ph.sineX) {
        const kick = ph.sineAmp * S * dt;
        this._vel[i*3]   += Math.sin(this._T * ph.sineFreq + this._pha[i]) * kick;
        this._vel[i*3+2] += Math.cos(this._T * (ph.sineFreq * 0.77) + this._pha[i]) * kick;
      }

      // Integrate
      this._pos[i*3]   += this._vel[i*3]   * dt;
      this._pos[i*3+1] += this._vel[i*3+1] * dt;
      this._pos[i*3+2] += this._vel[i*3+2] * dt;

      // Chaos hue shift
      if (d.chaos && !iB) {
        this._hue[i] = (this._hue[i] + dt * 0.4) % 1.0;
        const [r, g, b] = _hsl(this._hue[i], 1.0, 0.7);
        this._col[i*3] = r; this._col[i*3+1] = g; this._col[i*3+2] = b;
      }
    }

    /* ── Compact alive particles → GPU write buffers ──────────
       Dead particles excluded entirely (no phantom rendering).  */
    let w = 0;
    for (let i = 0; i < MAX_P; i++) {
      if (this._life[i] <= 0) continue;
      const l     = this._life[i] / Math.max(1e-4, this._maxL[i]); // normalised [0-1]
      const iB    = this._idx[i];
      const bright = iB ? 0.88 : 0.72;
      const alpha  = l * (iB ? 0.92 : 0.78);

      let cr = this._col[i*3], cg = this._col[i*3+1], cb = this._col[i*3+2];

      this._gPos[w*3]   = this._pos[i*3];
      this._gPos[w*3+1] = this._pos[i*3+1];
      this._gPos[w*3+2] = this._pos[i*3+2];
      this._gCol[w*3]   = cr * l * bright;
      this._gCol[w*3+1] = cg * l * bright;
      this._gCol[w*3+2] = cb * l * bright;
      this._gA[w]       = alpha;
      this._gSz[w]      = this._sz[i] * Math.max(0.01, l);
      w++;
    }

    this._geom.setDrawRange(0, w);
    this._geom.attributes.position.needsUpdate = true;
    this._geom.attributes.pCol.needsUpdate     = true;
    this._geom.attributes.pSz.needsUpdate      = true;
    this._geom.attributes.pA.needsUpdate       = true;
  }

  dispose(scene) {
    scene.remove(this._pts);
    this._geom.dispose();
    // Note: _sharedMat is NOT disposed (shared across all instances)
  }
}

/* ═══════════════════════════════════════════════════════════════
   VFX3D_ELC  —  전기 (Electric)
   Spark-style: emit from exact pos, high-random velocity.
   Color: white → cyan (#3ee8ff) → purple (#7c3aed) by remaining life.
   ═══════════════════════════════════════════════════════════════ */
class VFX3D_ELC extends VFX3DParticles {
  emitTrail(origin /*, dir unused */) {
    const d = this.data, S = FORT_SCALE;
    for (let e = 0; e < d.tr.n; e++) {
      const i   = this._alloc();
      const ang = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const spd = (40 + Math.random() * 140) * S; // source: 40~180 px/s
      this._pos[i*3]   = origin.x;
      this._pos[i*3+1] = origin.y;
      this._pos[i*3+2] = origin.z;
      this._vel[i*3]   = Math.sin(phi) * Math.cos(ang) * spd;
      this._vel[i*3+1] = Math.cos(phi) * spd;
      this._vel[i*3+2] = Math.sin(phi) * Math.sin(ang) * spd;
      this._pha[i]     = Math.random() * Math.PI * 2;
      const l          = 0.3 + Math.random() * 0.35;
      this._life[i]    = l;
      this._maxL[i]    = l;
      this._sz[i]      = d.sz * 0.4;
      this._idx[i]     = 0;
      // Colour computed in update() based on remaining life ratio
      this._col[i*3] = 1; this._col[i*3+1] = 1; this._col[i*3+2] = 1;
    }
  }

  update(dt) {
    this._T += dt;
    const d = this.data, S = FORT_SCALE;
    const gy = d.ph.gy * S; // 40 (falling sparks)

    for (let i = 0; i < MAX_P; i++) {
      if (this._life[i] <= 0) continue;
      const iB  = this._idx[i];
      const dec = iB ? d.ph.bDec : d.ph.tDec;
      this._life[i] -= dt * dec;
      if (this._life[i] <= 0) { this._life[i] = 0; continue; }
      const drg = 1 - dt * (iB ? d.ph.bDrg : d.ph.tDrg);
      this._vel[i*3]   *= drg;
      this._vel[i*3+1] *= drg;
      this._vel[i*3+2] *= drg;
      this._vel[i*3+1] -= gy * dt;
      this._pos[i*3]   += this._vel[i*3]   * dt;
      this._pos[i*3+1] += this._vel[i*3+1] * dt;
      this._pos[i*3+2] += this._vel[i*3+2] * dt;
    }

    // GPU buffer — ELC colour progression
    let w = 0;
    for (let i = 0; i < MAX_P; i++) {
      if (this._life[i] <= 0) continue;
      const l  = this._life[i] / Math.max(1e-4, this._maxL[i]);
      const iB = this._idx[i];
      let cr, cg, cb;
      if (iB) {
        // burst: high-life = white, mid = cyan, low = purple
        if (l > 0.55) { cr=1; cg=1; cb=1; }
        else if (l > 0.3) { cr=0.243; cg=0.910; cb=1.0; }
        else { cr=0.486; cg=0.227; cb=0.929; }
      } else {
        if (l > 0.55) { cr=1; cg=1; cb=1; }
        else if (l > 0.3) { cr=0.243; cg=0.910; cb=1.0; }
        else { cr=0.486; cg=0.227; cb=0.929; }
      }
      this._gPos[w*3]=this._pos[i*3]; this._gPos[w*3+1]=this._pos[i*3+1]; this._gPos[w*3+2]=this._pos[i*3+2];
      this._gCol[w*3]=cr*l; this._gCol[w*3+1]=cg*l; this._gCol[w*3+2]=cb*l;
      this._gA[w]  = l * 0.90;
      this._gSz[w] = d.sz * 0.4 * Math.max(0.01, l);
      w++;
    }
    this._geom.setDrawRange(0, w);
    this._geom.attributes.position.needsUpdate = true;
    this._geom.attributes.pCol.needsUpdate     = true;
    this._geom.attributes.pSz.needsUpdate      = true;
    this._geom.attributes.pA.needsUpdate       = true;
  }
}

/* ═══════════════════════════════════════════════════════════════
   VFX3D_FIR  —  불꽃 (Fire)
   Upward-biased trail, sinusoidal X flicker, fire colour ramp.
   ═══════════════════════════════════════════════════════════════ */
class VFX3D_FIR extends VFX3DParticles {
  emitTrail(origin, dir) {
    const d = this.data, S = FORT_SCALE;
    for (let e = 0; e < d.tr.n; e++) {
      const i   = this._alloc();
      const ang = Math.random() * Math.PI * 2;
      const sp  = Math.random() * d.tr.sp * S;
      this._pos[i*3]   = origin.x + Math.cos(ang) * sp;
      this._pos[i*3+1] = origin.y + (Math.random() - 0.5) * sp;
      this._pos[i*3+2] = origin.z + Math.sin(ang) * sp;
      const tv = d.tr.tvR * S;
      this._vel[i*3]   = (Math.random() - 0.5) * tv;
      this._vel[i*3+1] = (50 + Math.random() * 85) * S; // upward launch
      this._vel[i*3+2] = (Math.random() - 0.5) * tv;
      // Backward from travel direction
      if (dir) {
        this._vel[i*3]   -= dir.x * 25 * S;
        this._vel[i*3+2] -= dir.z * 25 * S;
      }
      this._pha[i]  = Math.random() * Math.PI * 2;
      this._sz[i]   = (d.tr.rMn + Math.random() * (d.tr.rMx - d.tr.rMn)) * S * 0.5;
      this._life[i] = 1.0;
      this._maxL[i] = 1.0;
      this._idx[i]  = 0;
      // Store hot-yellow as base; colour ramp in update()
      this._col[i*3]=1; this._col[i*3+1]=0.91; this._col[i*3+2]=0.27;
    }
  }

  update(dt) {
    this._T += dt;
    const d = this.data, S = FORT_SCALE;
    const ph = d.ph;

    for (let i = 0; i < MAX_P; i++) {
      if (this._life[i] <= 0) continue;
      const iB = this._idx[i];
      const dec = iB
        ? (ph.bDec)
        : ph.tDecMn + Math.random() * (ph.tDecMx - ph.tDecMn);
      this._life[i] -= dt * dec;
      if (this._life[i] <= 0) { this._life[i] = 0; continue; }
      if (!iB) {
        // Trail: sinusoidal X, upward pull, asymmetric drag
        this._vel[i*3] += Math.sin(this._T * ph.sineFreq + this._pha[i]) * ph.sineAmp * S * dt;
        this._vel[i*3+1] += 10 * S * dt; // extra upward float
        this._vel[i*3]   *= (1 - dt * ph.tDrgX);
        this._vel[i*3+1] *= (1 - dt * ph.tDrgY);
        this._vel[i*3+2] *= (1 - dt * ph.tDrgX);
        this._vel[i*3+1] -= ph.gyT * S * dt; // gyT=-10 → +0.15 → rises
      } else {
        // Burst: standard drag + upward bias
        const drg = 1 - dt * ph.bDrg;
        this._vel[i*3]   *= drg;
        this._vel[i*3+1] *= drg;
        this._vel[i*3+2] *= drg;
        this._vel[i*3+1] -= ph.gyB * S * dt; // gyB=-20 → rises more
      }
      this._pos[i*3]   += this._vel[i*3]   * dt;
      this._pos[i*3+1] += this._vel[i*3+1] * dt;
      this._pos[i*3+2] += this._vel[i*3+2] * dt;
    }

    let w = 0;
    for (let i = 0; i < MAX_P; i++) {
      if (this._life[i] <= 0) continue;
      const l  = this._life[i] / Math.max(1e-4, this._maxL[i]);
      const iB = this._idx[i];
      // Fire colour ramp: yellow → orange → red
      let cr, cg, cb;
      if (l > 0.68) { cr=1.0; cg=0.91; cb=0.27; }     // hot yellow
      else if (l > 0.38) { cr=1.0; cg=0.47; cb=0.06; } // orange
      else { cr=1.0; cg=0.13; cb=0.0; }                 // red
      this._gPos[w*3]=this._pos[i*3]; this._gPos[w*3+1]=this._pos[i*3+1]; this._gPos[w*3+2]=this._pos[i*3+2];
      this._gCol[w*3]=cr*l*0.85; this._gCol[w*3+1]=cg*l*0.85; this._gCol[w*3+2]=cb*l*0.85;
      this._gA[w]  = l * (iB ? 0.88 : 0.65);
      this._gSz[w] = this._sz[i] * (l > 0.5 ? 1.0 : l * 2.0);
      w++;
    }
    this._geom.setDrawRange(0, w);
    this._geom.attributes.position.needsUpdate = true;
    this._geom.attributes.pCol.needsUpdate     = true;
    this._geom.attributes.pSz.needsUpdate      = true;
    this._geom.attributes.pA.needsUpdate       = true;
  }
}

/* ═══════════════════════════════════════════════════════════════
   VFX3D_ICE  —  얼음 (Ice)
   Slow drift, high drag, sparkle brightness flash on spawn,
   colour ramp: pale-blue → ice-white as life falls.
   ═══════════════════════════════════════════════════════════════ */
class VFX3D_ICE extends VFX3DParticles {
  update(dt) {
    super.update(dt); // physics handled by base (tDec=0.85, tDrg=4.0)
    // Post-process: rewrite GPU colour buffer with ice sparkle ramp
    let w = 0;
    for (let i = 0; i < MAX_P; i++) {
      if (this._life[i] <= 0) continue;
      const l     = this._life[i] / Math.max(1e-4, this._maxL[i]);
      const flash = Math.min(1.0, l * 1.5);
      // pale-blue → white as particle ages
      const cr = 0.40 + l * 0.60;
      const cg = 0.80 + l * 0.20;
      const cb = 1.00;
      this._gPos[w*3]=this._pos[i*3]; this._gPos[w*3+1]=this._pos[i*3+1]; this._gPos[w*3+2]=this._pos[i*3+2];
      this._gCol[w*3]=cr*flash; this._gCol[w*3+1]=cg*flash; this._gCol[w*3+2]=cb*flash;
      this._gA[w]  = Math.min(l, 0.55) * 0.60;
      this._gSz[w] = this._sz[i] * Math.min(1.0, l * 1.5);
      w++;
    }
    this._geom.setDrawRange(0, w);
    this._geom.attributes.position.needsUpdate = true;
    this._geom.attributes.pCol.needsUpdate     = true;
    this._geom.attributes.pSz.needsUpdate      = true;
    this._geom.attributes.pA.needsUpdate       = true;
  }
}

/* ═══════════════════════════════════════════════════════════════
   VFX3D_WAT  —  물 (Water)
   Adds expanding ring system (6–8 rings) on top of base particles,
   matching the source's ripple/concentric-ring behaviour.
   ═══════════════════════════════════════════════════════════════ */
class VFX3D_WAT extends VFX3DParticles {
  constructor(type, scene) {
    super(type, scene);
    const N = 8; // ring slot count (matches source)
    this._rR  = new Float32Array(N);  // current radius (world units)
    this._rL  = new Float32Array(N);  // life [0-1]
    this._rX  = new Float32Array(N);
    this._rY  = new Float32Array(N);
    this._rZ  = new Float32Array(N);
    this._rPtr = 0;
    this._lastRingT = -999;

    // Build ring Line geometries (32 segments each)
    const SEG = 32;
    this._rings = [];
    for (let r = 0; r < N; r++) {
      const geom = new THREE.BufferGeometry();
      const pts  = new Float32Array((SEG + 1) * 3);
      for (let s = 0; s <= SEG; s++) {
        const a = s / SEG * Math.PI * 2;
        pts[s*3] = Math.cos(a); pts[s*3+1] = 0; pts[s*3+2] = Math.sin(a);
      }
      geom.setAttribute('position', new THREE.BufferAttribute(pts, 3));
      const mat  = new THREE.LineBasicMaterial({ color: 0x44aaff, transparent: true, opacity: 0, depthWrite: false });
      const line = new THREE.Line(geom, mat);
      line.frustumCulled = false;
      scene.add(line);
      this._rings.push({ line, geom, mat });
    }
    this._scene = scene;
  }

  emitTrail(origin, dir) {
    super.emitTrail(origin, dir);
    // Ripple every 0.22 s — matches source `if(T-p.lR>.22)`
    if (this._T - this._lastRingT >= 0.22) {
      this._lastRingT = this._T;
      const r = this._rPtr % 8;
      this._rPtr++;
      this._rR[r] = 8 * FORT_SCALE;
      this._rL[r] = 1.0;
      this._rX[r] = origin.x;
      this._rY[r] = origin.y;
      this._rZ[r] = origin.z;
    }
  }

  burst(center) {
    super.burst(center);
    for (let r = 0; r < 8; r++) {
      this._rR[r] = 5 * FORT_SCALE;
      this._rL[r] = 1.0;
      this._rX[r] = center.x;
      this._rY[r] = center.y;
      this._rZ[r] = center.z;
    }
    this._rPtr = 8;
  }

  update(dt) {
    super.update(dt);
    // Expand + fade rings
    for (let r = 0; r < 8; r++) {
      const ring = this._rings[r];
      if (this._rL[r] <= 0) { ring.mat.opacity = 0; continue; }
      this._rL[r] -= dt * 1.4;           // decay matches source
      this._rR[r] += dt * 60 * FORT_SCALE; // expand: 60 px/s → world units
      if (this._rL[r] <= 0) { ring.mat.opacity = 0; continue; }
      ring.mat.opacity = this._rL[r] * 0.55;
      ring.line.position.set(this._rX[r], this._rY[r], this._rZ[r]);
      ring.line.scale.setScalar(this._rR[r]);
    }
  }

  dispose(scene) {
    super.dispose(scene);
    for (const ring of this._rings) {
      scene.remove(ring.line);
      ring.geom.dispose();
      ring.mat.dispose();
    }
  }
}

/* ═══════════════════════════════════════════════════════════════
   TYPE MAP  —  key → class
   Unmapped types fall back to VFX3DParticles (generic).
   ═══════════════════════════════════════════════════════════════ */
const VFX3D_CLASSES = {
  elc: VFX3D_ELC,
  irn: VFX3D_ELC,   // irn shares spark emitter (same emission style)
  fir: VFX3D_FIR,
  drg: VFX3D_FIR,   // dragon-fire shares fire emitter
  dkf: VFX3D_FIR,   // dark-fire shares fire emitter (downward variant)
  ice: VFX3D_ICE,
  wat: VFX3D_WAT,
  dat: VFX3D_WAT,   // dat has similar ripple rings
};

/* ═══════════════════════════════════════════════════════════════
   FortressVFX  —  Session manager
   ═══════════════════════════════════════════════════════════════

   USAGE
   ─────
   // In fortressFire():
   const vfx = FortressVFX.spawn('fir', scene);

   // In missileStep() (per physics step):
   if (step % 4 === 0) vfx.emitTrail(missilePos, missileDir);

   // On impact:
   vfx.burst(impactPos);
   FortressVFX.scheduleDispose(vfx, scene, 2200);

   // In main animate():
   FortressVFX.update(delta);
   ═══════════════════════════════════════════════════════════════ */
const FortressVFX = (() => {
  const _active  = new Set();
  const _pending = []; // { inst, scene } waiting for setTimeout

  return {
    /**
     * Spawn a new VFX instance and register it.
     * @param  {string}       type   e.g. 'fir'
     * @param  {THREE.Scene}  scene
     * @returns {VFX3DParticles}
     */
    spawn(type, scene) {
      const Cls  = VFX3D_CLASSES[type] ?? VFX3DParticles;
      const inst = new Cls(type, scene);
      _active.add(inst);
      return inst;
    },

    /**
     * Call once per frame in your animate() loop.
     * @param {number} dt  Delta time in seconds
     */
    update(dt) {
      for (const inst of _active) inst.update(dt);
      // Flush any instances waiting for disposal
      for (let i = _pending.length - 1; i >= 0; i--) {
        const { inst, scene, due } = _pending[i];
        if (performance.now() >= due) {
          inst.dispose(scene);
          _active.delete(inst);
          _pending.splice(i, 1);
        }
      }
    },

    /**
     * Dispose after delayMs (allows burst to fade out).
     * Default 2200 ms → matches source BURST_TTL=2.2 s.
     */
    scheduleDispose(inst, scene, delayMs = 2200) {
      _pending.push({ inst, scene, due: performance.now() + delayMs });
    },

    /** Immediate disposal (e.g. level reset). */
    disposeAll(scene) {
      for (const inst of _active) inst.dispose(scene);
      _active.clear();
      _pending.length = 0;
    },

    /** Query active instance count (for debugging). */
    activeCount() { return _active.size; },

    /** Read-only catalog (for UI, type switching). */
    DATA: VFX3D_DATA,
  };
})();

/* ═══════════════════════════════════════════════════════════════
   FORTRESS INTEGRATION SNIPPET
   ═══════════════════════════════════════════════════════════════

   Drop the lines marked ← ADD into your existing Fortress code.
   ─────────────────────────────────────────────────────────────

   // 1. GLOBAL SETUP (run once on init)
   // FortressVFX is globally available after this script loads.
   // ∴ no import needed if loaded via <script> before your main file.

   // 2. SELECT PROJECTILE TYPE FROM UI
   let fortressVFXType = 'fir'; // default — change via UI buttons
   // document.querySelector('#vfx-picker').addEventListener('click', e => {
   //   if (e.target.dataset.vfx) fortressVFXType = e.target.dataset.vfx;
   // });

   // 3. fortressFire — ADD vfx lines
   function fortressFire(power) {
     // ... existing launch code (physics, angle, etc.) ...

     const vfx = FortressVFX.spawn(fortressVFXType, scene); // ← ADD

     let step = 0;
     function missileStep() {
       // ... your existing physics update (update pos, vel) ...

       if (step % 4 === 0) {                                // ← ADD
         vfx.emitTrail(missileBody.position, missileVel);  // ← ADD
       }                                                     // ← ADD
       step++;

       if (hit) {
         vfx.burst(impactPos);                                       // ← ADD
         FortressVFX.scheduleDispose(vfx, scene, 2200);              // ← ADD
         // ... existing impact / damage code ...
         return;
       }
       requestAnimationFrame(missileStep);
     }
     missileStep();
   }

   // 4. animate() — ADD update call
   function animate() {
     const dt = clock.getDelta();
     FortressVFX.update(dt);   // ← ADD (before renderer.render)
     // ... rest of animate ...
     renderer.render(scene, camera);
     requestAnimationFrame(animate);
   }

   // 5. CANNON BODY → THREE POSITION adapter
   // missileBody.position is a CANNON.Vec3, not THREE.Vector3.
   // Either pass it directly (duck-typing works for x/y/z access)
   // or wrap: const missilePos = new THREE.Vector3().copy(missileBody.position);

   ═══════════════════════════════════════════════════════════════ */

/* ── Export (ESM + CommonJS + global) ──────────────────────────── */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { FortressVFX, VFX3D_DATA, VFX3D_CLASSES, VFX3DParticles };
} else if (typeof define === 'function' && define.amd) {
  define([], () => ({ FortressVFX, VFX3D_DATA, VFX3D_CLASSES, VFX3DParticles }));
} else {
  (typeof globalThis !== 'undefined' ? globalThis : window).VFX3D = {
    FortressVFX, DATA: VFX3D_DATA, CLASSES: VFX3D_CLASSES, Base: VFX3DParticles
  };
}

/* [ESM] named exports — main game: import { FortressVFX } from './VFX3D_FORTRESS.js' */
export { FortressVFX, VFX3D_DATA, VFX3D_CLASSES, VFX3DParticles };
