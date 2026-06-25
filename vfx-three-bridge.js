/**
 * vfx-three-bridge.js  v1.0
 * ─────────────────────────────────────────────────────────────────
 * Canvas2D VFX (vfx-game-integration.js) → Three.js
 *
 * 로드 순서:
 *   1. vfx-game-integration.js   → window.VFX, window.VFXCoords
 *   2. three.js                  → window.THREE
 *   3. vfx-three-bridge.js       → window.VFXThree
 *
 * 두 모드:
 *   A) Overlay  — CSS canvas 적층, screen-space (HUD/히트/풀스크린)
 *   B) Texture  — CanvasTexture → PlaneGeometry, world-space 3D 위치
 *
 * 기본 사용법:
 *   const bridge = new VFXThreeBridge(renderer, scene, camera);
 *   VFX._bulkFX({ 'FX12': FX12 });
 *
 *   // 게임 루프 (THREE.js RAF 안에서)
 *   function loop(now) {
 *     const dt = Math.min((now - last) * 0.001, 0.05); last = now;
 *     bridge.update(dt);              // ← VFX + texture 동기화
 *     renderer.render(scene, camera); // ← Three.js 렌더
 *     requestAnimationFrame(loop);
 *   }
 *
 *   // Screen-space 이펙트 (renderer 위 overlay canvas)
 *   bridge.spawnScreen('FX12', { layer: 'vfx', bg: false });
 *
 *   // World-space 이펙트 (Three.js PlaneGeometry + CanvasTexture)
 *   bridge.spawnWorld('FX05', { position: new THREE.Vector3(0,1,0), planeW:2 });
 *
 *   // 3D 위치 → screen-space overlay
 *   bridge.spawnAtWorld('FX12', new THREE.Vector3(5, 0, -3));
 */

'use strict';

import * as THREE from 'three';   // [ESM] module-scoped THREE (importmap)

const _DPR3   = Math.min(2, window.devicePixelRatio || 1);
const _clamp3 = (v, a, b) => v < a ? a : v > b ? b : v;

/* ═══════════════════════════════════════════════════════════
   § A  OVERLAY BRIDGE  — CSS canvas stack over renderer.domElement
   ═══════════════════════════════════════════════════════════ */
class VFXOverlayBridge {
  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {object} opts
   *   container  : HTMLElement (default: renderer.domElement.parentElement)
   *   layers     : [{ label, z }] (default: vfx@20, hud@40)
   */
  constructor(renderer, opts = {}) {
    this._renderer  = renderer;
    this._el        = renderer.domElement;
    this._container = opts.container || this._el.parentElement;
    this._layers    = {};   // label → <canvas>
    this._handles   = [];   // active VFX handles (for dead cleanup)

    this._initContainer();

    const defs = opts.layers || [{ label: 'vfx', z: 20 }, { label: 'hud', z: 40 }];
    for (const def of defs) {
      if (typeof def === 'string') this._addLayer(def, 20);
      else this._addLayer(def.label, def.z ?? 20);
    }

    this._initResize();
  }

  _initContainer() {
    const c = this._container;
    if (!c) return;
    if (window.getComputedStyle(c).position === 'static') c.style.position = 'relative';
    // Three.js canvas → position context에 맞춰 absolute
    this._el.style.position = 'absolute';
    this._el.style.inset    = '0';
    this._el.style.width    = '100%';
    this._el.style.height   = '100%';
  }

  _addLayer(label, z) {
    const cv = document.createElement('canvas');
    cv.dataset.vfxLayer = label;
    cv.style.cssText = [
      'position:absolute', 'inset:0', 'width:100%', 'height:100%',
      `z-index:${z}`, 'pointer-events:none'
    ].join(';');
    const cw = this._container?.clientWidth  || this._el.width  || 800;
    const ch = this._container?.clientHeight || this._el.height || 600;
    cv.width  = Math.floor(cw * _DPR3);
    cv.height = Math.floor(ch * _DPR3);
    this._container?.appendChild(cv);
    this._layers[label] = cv;
    return cv;
  }

  /** label → <canvas> */
  layer(label = 'vfx') { return this._layers[label]; }

  /**
   * Spawn effect onto overlay canvas.
   * opts.layer : layer label (default 'vfx')
   * opts.bg    : false → transparent bg (default false)
   * + 모든 VFX.spawn opts
   */
  spawn(name, opts = {}) {
    const label  = opts.layer || 'vfx';
    const cv     = this._layers[label];
    if (!cv) { console.warn('[VFXThree.Overlay] unknown layer:', label); return null; }
    // canvas → overlay canvas로 강제 (opts.canvas 무시)
    const { canvas: _c, layer: _l, ...rest } = opts;
    const handle = window.VFX.spawn(name, { ...rest, canvas: cv, bg: rest.bg ?? false });
    if (handle) this._handles.push(handle);
    return handle;
  }

  /**
   * Three.js Vector3 → normalized screen coords (0~1)
   * @param {THREE.Vector3} vec3
   * @param {THREE.Camera}  camera
   * @returns {{ x, y }}
   */
  worldToNorm(vec3, camera) {
    const v = vec3.clone().project(camera);
    return {
      x: _clamp3((v.x + 1) * 0.5, 0, 1),
      y: _clamp3((1 - v.y) * 0.5, 0, 1)   // NDC Y-up → screen Y-down
    };
  }

  /**
   * Spawn at 3D world position → screen overlay.
   * @param {string}        name
   * @param {THREE.Vector3} vec3
   * @param {THREE.Camera}  camera
   * @param {object}        opts  (layer, bg, param, ...)
   *
   * ★ trigger 좌표 단위:
   *   wrapFX  → fxModule.trigger(d, canvasPx, canvasPx)   — 캔버스 픽셀 기대
   *   wrapOOP → _inst.trigger(canvasPx, canvasPx)
   *   ONESHOT → skillFn(canvas, onDone, castX, castY, bg)  — 픽셀, trigger('play')
   *   정규화(0~1) 전달 시 효과가 (0,0) 근처에 고정되는 버그 발생.
   */
  spawnAt(name, vec3, camera, opts = {}) {
    const norm  = this.worldToNorm(vec3, camera);
    const label = opts.layer || 'vfx';
    const cv    = this._layers[label];
    const h = this.spawn(name, { ...opts, bg: opts.bg ?? false });
    if (!h) return null;

    // normalized → canvas px  (wrapFX/wrapOOP/OneShot 모두 px 기대)
    const pxX = cv ? norm.x * cv.width  : norm.x;
    const pxY = cv ? norm.y * cv.height : norm.y;
    const bg  = opts.bg ?? false;

    // ONESHOT(AC/SK/SC): trigger('play') 로 즉시 발사 + 위치 전달
    // FX / OOP        : trigger('spawn') 으로 캐스트 위치 설정
    if (h.emi?._type === 'ONESHOT') {
      h.trigger('play', { x: pxX, y: pxY, bg });
    } else {
      h.trigger('spawn', { x: pxX, y: pxY });
    }
    return h;
  }

  /**
   * 게임 루프에서 1회 호출. dt=seconds.
   * NOTE: VFXThreeBridge.update() 사용 시 직접 호출 불필요 (이중 updateAll 방지).
   */
  update(dt) {
    window.VFX.updateAll(dt);
    window.VFX.renderCanvas2D();
    this._pruneHandles();
  }

  _pruneHandles() {
    for (let i = this._handles.length - 1; i >= 0; i--) {
      if (this._handles[i].dead) this._handles.splice(i, 1);
    }
  }

  _initResize() {
    if (!this._container || typeof ResizeObserver === 'undefined') return;
    this._ro = new ResizeObserver(([e]) => {
      const w = Math.floor(e.contentRect.width  * _DPR3);
      const h = Math.floor(e.contentRect.height * _DPR3);
      for (const cv of Object.values(this._layers)) {
        cv.width = w; cv.height = h;
      }
    });
    this._ro.observe(this._container);
  }

  dispose() {
    this._ro?.disconnect();
    for (const cv of Object.values(this._layers)) cv.parentNode?.removeChild(cv);
    this._layers  = {};
    this._handles = [];
  }
}


/* ═══════════════════════════════════════════════════════════
   § B  TEXTURE BRIDGE  — CanvasTexture → PlaneGeometry (world-space)
   ═══════════════════════════════════════════════════════════
   VFX effect → 오프스크린 canvas → THREE.CanvasTexture → Mesh
   이펙트가 3D 공간에 위치하며 카메라와 함께 렌더링됨.
   ★ OneShot(AC/SC) 계열 사용 시 size를 충분히 크게 (≥512).
   ═══════════════════════════════════════════════════════════ */
class VFXTextureBridge {
  constructor() { this._entries = []; }

  /**
   * @param {string}       name    registered effect name
   * @param {THREE.Scene}  scene
   * @param {object}       opts
   *   size        : canvas px (default 512)
   *   planeW/H    : world-space plane 크기 (default 1.0)
   *   position    : THREE.Vector3
   *   blending    : THREE.Blending (default AdditiveBlending)
   *   depthTest   : boolean (default false)
   *   renderOrder : mesh renderOrder (default 999)
   *   billboard   : true → camera 방향으로 자동 회전 (default true)
   *   bg          : false → 투명 배경 (default false)
   *   + VFX.spawn opts (param, etc.)
   * @returns {{ handle, mesh, texture, cv }}
   */
  spawn(name, scene, opts = {}) {
    const size  = opts.size ?? 512;

    // Detached DOM canvas 사용 (OffscreenCanvas → addEventListener 불가)
    const cv = document.createElement('canvas');
    cv.width = cv.height = size;

    // canvas, size, Three.js 전용 opts 제거 후 VFX에 전달
    const { canvas: _c, size: _s, planeW: _pw, planeH: _ph,
            position: _p, blending: _b, depthTest: _dt,
            renderOrder: _ro, billboard: _bb, ...vfxOpts } = opts;

    const handle = window.VFX.spawn(name, { ...vfxOpts, canvas: cv, bg: vfxOpts.bg ?? false });
    if (!handle) return null;

    const texture = new THREE.CanvasTexture(cv);
    texture.premultiplyAlpha = false;

    const mat = new THREE.MeshBasicMaterial({
      map:         texture,
      transparent: true,
      depthWrite:  false,
      depthTest:   opts.depthTest  ?? false,
      blending:    opts.blending   ?? THREE.AdditiveBlending,
      side:        THREE.DoubleSide,
    });

    const geo  = new THREE.PlaneGeometry(opts.planeW ?? 1, opts.planeH ?? 1);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder           = opts.renderOrder ?? 999;
    mesh.userData._billboard   = opts.billboard   ?? true;
    if (opts.position) mesh.position.copy(opts.position);
    scene.add(mesh);

    const entry = { handle, texture, mesh, cv };
    this._entries.push(entry);
    return entry;
  }

  /**
   * 프레임마다 texture 동기화 + dead entry 정리.
   * camera 전달 시 billboard 회전 적용.
   * NOTE: VFX.updateAll 이후 호출 (VFXThreeBridge.update가 순서 보장).
   */
  syncTextures(camera) {
    for (let i = this._entries.length - 1; i >= 0; i--) {
      const e = this._entries[i];
      if (e.handle.dead) { this._disposeEntry(e); this._entries.splice(i, 1); continue; }
      e.texture.needsUpdate = true;
      if (camera && e.mesh.userData._billboard) {
        e.mesh.quaternion.copy(camera.quaternion);
      }
    }
  }

  /** entry = spawn() 반환값 */
  remove(entry) {
    const i = this._entries.indexOf(entry);
    if (i === -1) return;
    entry.handle.destroy();
    this._disposeEntry(entry);
    this._entries.splice(i, 1);
  }

  _disposeEntry(e) {
    e.mesh.parent?.remove(e.mesh);
    e.mesh.geometry.dispose();
    e.mesh.material.dispose();
    e.texture.dispose();
  }

  dispose() {
    for (const e of [...this._entries]) { e.handle.destroy(); this._disposeEntry(e); }
    this._entries = [];
  }
}


/* ═══════════════════════════════════════════════════════════
   § C  COMBINED BRIDGE  — Overlay + Texture, updateAll 1회 보장
   ═══════════════════════════════════════════════════════════ */
class VFXThreeBridge {
  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {THREE.Scene}         scene
   * @param {THREE.Camera}        camera
   * @param {object}              opts  → VFXOverlayBridge opts
   */
  constructor(renderer, scene, camera, opts = {}) {
    this.overlay  = new VFXOverlayBridge(renderer, opts);
    this.texture  = new VFXTextureBridge();
    this._scene   = scene;
    this._camera  = camera;
  }

  /** Screen-space → overlay canvas */
  spawnScreen(name, opts = {}) {
    return this.overlay.spawn(name, opts);
  }

  /** World-space → CanvasTexture PlaneGeometry */
  spawnWorld(name, opts = {}) {
    return this.texture.spawn(name, this._scene, opts);
  }

  /** 3D world 좌표 → screen overlay (카메라 기준 projection) */
  spawnAtWorld(name, vec3, opts = {}) {
    return this.overlay.spawnAt(name, vec3, this._camera, opts);
  }

  /**
   * 게임 루프에서 1회 호출. renderer.render() 이전.
   * VFX.updateAll dt 이중 호출 없음.
   * dt: seconds
   */
  update(dt) {
    // ── VFX 전체 업데이트 (1회) ──────────────────────────────
    window.VFX.updateAll(dt);
    window.VFX.renderCanvas2D();

    // ── Overlay: dead handle 정리 ─────────────────────────────
    this.overlay._pruneHandles();

    // ── Texture: needsUpdate + billboard + dead 정리 ──────────
    this.texture.syncTextures(this._camera);
  }

  /** 카메라 교체 (split-screen 등) */
  setCamera(camera) { this._camera = camera; }

  dispose() {
    this.overlay.dispose();
    this.texture.dispose();
  }
}


/* ═══════════════════════════════════════════════════════════
   § D  VFX LOADER  — script/module dynamic loading
   ─────────────────────────────────────────────────────────
   VFX effect 파일을 URL(GitHub raw 등)에서 동적으로 로드.
   effect 파일 내에서 VFX.register() / VFX._bulkFX() 자동 호출.
   ═══════════════════════════════════════════════════════════ */
const VFXLoader = {
  _loaded: new Set(),

  /**
   * Script 태그 방식 (IIFE / window.VFX 의존 effect 파일)
   * @param {string}  url
   * @param {boolean} force  이미 로드된 URL 재로드
   */
  load(url, force = false) {
    if (!force && this._loaded.has(url)) return Promise.resolve(true);
    return new Promise((resolve, reject) => {
      const s    = document.createElement('script');
      s.src      = url;
      s.onload  = () => { this._loaded.add(url); resolve(true); };
      s.onerror = () => reject(new Error(`[VFXLoader] load failed: ${url}`));
      document.head.appendChild(s);
    });
  },

  /** 복수 URL 병렬 로드 */
  loadMany(urls, force = false) {
    return Promise.all(urls.map(u => this.load(u, force)));
  },

  /**
   * ES module import (effect 파일이 export default fxModule 형태)
   * @returns {Promise<object>} fxModule
   */
  async importModule(url) {
    const mod = await import(/* @vite-ignore */ url);
    return mod.default || mod;
  },

  /**
   * GitHub raw URL 헬퍼
   * @param {string} repo   'user/repo'
   * @param {string} path   'effects/fx12.js'
   * @param {string} branch 'main'
   */
  githubRaw(repo, path, branch = 'main') {
    return `https://raw.githubusercontent.com/${repo}/${branch}/${path}`;
  }
};


/* ═══════════════════════════════════════════════════════════
   § E  THREE.js ↔ VFXCoords 어댑터
   ─────────────────────────────────────────────────────────
   기존 VFXCoords.worldToNorm(wx,wy,wz, camMatrix) 대신
   Three.js camera 직접 전달 가능한 래퍼.
   ═══════════════════════════════════════════════════════════ */
const VFXThreeCoords = {
  /**
   * Three.js Vector3 + camera → 0~1 normalized screen coords
   * VFXCoords.worldToNorm과 동일 결과, Three.js API 사용.
   */
  worldToNorm(vec3, camera) {
    const v = vec3.clone().project(camera);
    return {
      x: _clamp3((v.x + 1) * 0.5, 0, 1),
      y: _clamp3((1 - v.y) * 0.5, 0, 1)
    };
  },

  /**
   * 기존 VFXCoords.worldToNorm용 MVP Float32Array 추출
   * @returns {Float32Array}
   */
  getMVP(camera) {
    const m = new THREE.Matrix4().multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse
    );
    return new Float32Array(m.elements);
  }
};


/* ── expose ─────────────────────────────────────────────── */
if (typeof window !== 'undefined') {
  window.VFXThree = {
    VFXOverlayBridge,
    VFXTextureBridge,
    VFXThreeBridge,
    VFXLoader,
    VFXThreeCoords,
  };
}

// CommonJS / bundler (Webpack/Vite)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { VFXOverlayBridge, VFXTextureBridge, VFXThreeBridge, VFXLoader, VFXThreeCoords };
}

/* [ESM] named exports — main game: import { VFXThreeBridge } from './vfx-three-bridge.js' */
export { VFXOverlayBridge, VFXTextureBridge, VFXThreeBridge, VFXLoader, VFXThreeCoords };


/* ═══════════════════════════════════════════════════════════
   § USAGE EXAMPLES  (remove in production)
   ═══════════════════════════════════════════════════════════

// ── 기본 setup ────────────────────────────────────────────
const container = document.getElementById('game');  // position:relative 필요
const renderer  = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(container.clientWidth, container.clientHeight);
container.appendChild(renderer.domElement);

const scene  = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, container.clientWidth / container.clientHeight, 0.1, 1000);
camera.position.z = 5;

// ── bridge 생성 ───────────────────────────────────────────
const bridge = new VFXThreeBridge(renderer, scene, camera, {
  layers: [{ label: 'vfx', z: 20 }, { label: 'hud', z: 40 }]
});

// ── effect 등록 ───────────────────────────────────────────
// 방법 1) 직접 등록
VFX._bulkFX({ 'FX12': FX12, 'FX05': FX5 });

// 방법 2) GitHub raw URL에서 동적 로드
await VFXLoader.load(VFXLoader.githubRaw('user/vfx-lib', 'effects/fx12.js'));
// fx12.js 내부에서 VFX.register('FX12', FX12) 자동 호출

// 방법 3) ES module import
const FX12 = await VFXLoader.importModule('./effects/fx12.module.js');
VFX.register('FX12', FX12, 'FX');

// ── 게임 루프 ─────────────────────────────────────────────
let last = performance.now();
function loop(now) {
  const dt = Math.min((now - last) * 0.001, 0.05); last = now;
  bridge.update(dt);              // ← 반드시 renderer.render() 이전
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// ── screen-space spawn ────────────────────────────────────
const fx = bridge.spawnScreen('FX12', { layer: 'vfx', bg: false, param: 0.8 });
fx.trigger('burst', { intensity: 2.0 });
// → renderer.domElement 위 overlay canvas에 렌더링

// ── world-space spawn (CanvasTexture PlaneGeometry) ───────
const { handle, mesh } = bridge.spawnWorld('FX12', {
  position:    new THREE.Vector3(0, 1, 0),
  planeW:      2, planeH: 2,         // world 단위 크기
  size:        512,                  // canvas px 해상도
  blending:    THREE.AdditiveBlending,
  billboard:   true,                 // 카메라 방향으로 자동 회전
  bg:          false,
});

// ── 3D 위치 → screen overlay ──────────────────────────────
const enemy = new THREE.Vector3(3, 0, -5);
bridge.spawnAtWorld('FX12', enemy, { layer: 'vfx', bg: false });

// ── maxAge 자동 소멸 (§8 pool auto-return 활용) ───────────
VFX.spawn('FX12', { canvas: bridge.overlay.layer('vfx'), maxAge: 2.0, bg: false });

// ── resize ────────────────────────────────────────────────
window.addEventListener('resize', () => {
  const w = container.clientWidth, h = container.clientHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  // overlay canvas 자동 resize (ResizeObserver)
});

// ── 정리 ──────────────────────────────────────────────────
bridge.dispose();

*/
