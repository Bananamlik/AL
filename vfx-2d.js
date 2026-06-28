/* ════════════════════════════════════════════════════════════════
   vfx-2d.js ── GlobeStriker Canvas2D VFX 통합
   = 레지스트리(window.VFX) + merged 효과번들 + three-bridge
   exports: VFX, VFXThreeBridge, VFXOverlayBridge, VFXTextureBridge, VFXLoader, VFXThreeCoords
   의존: three(importmap). 메인HTML <script type=module>에서 import
   ════════════════════════════════════════════════════════════════ */
import * as THREE from 'three';

/* ===== [1] 레지스트리 ===== */
/**
 * vfx-game-integration.js  ·  Phase 0 MUST items  [v2.1 — double-init fix]
 * ─────────────────────────────────────────────────────────
 *  1. dt 단위 통일   → 전 계열 seconds 수신
 *  2. EMI 어댑터     → wrapFX / wrapV5 / wrapOOP
 *  3. 이펙트 레지스트리 → VFX.register / VFX.spawn / VFX.updateAll
 *
 * ── PATCH (이번 수정, "// [PATCH]" 주석으로 표시) ──────────────
 *  VFX-merged-v41 갤러리 파일 쪽에서 S등급 63종에 두 가지를 추가했는데,
 *  이 어댑터가 그 값을 안 옮겨주고 있어서 게임 쪽에서는 둘 다 동작하지 않았음:
 *    a) d.bg===false / this.bg===false → 효과 자신의 배경을 생략하는 투명배경 모드
 *    b) trigger(d,x,y) / trigger(x,y)  → 효과 자체에 있는 캐스트지점 API
 *       (기존엔 'spawn' 트리거가 d.mx/d.my만 바꿔서, cx=(d.tx!=null?d.tx:W/2)
 *        식으로 d.tx를 보는 효과들은 위치가 전혀 안 바뀌고 있었음)
 *  수정 위치: wrapFX.update/trigger, wrapOOP.update/trigger, wrapOneShot.trigger, spawn().
 *  vfx-game-build.js는 효과별 데이터를 직접 다루지 않는 오케스트레이션 레이어라 수정 없음.
 *
 * ── BUG FIX [v2.1] ─────────────────────────────────────────────
 *  EffectPool.acquire() 에서 신규 인스턴스 생성 시 init() 이 호출되고,
 *  spawn() 에서도 emi.init() 이 호출되어 _makeDemoLite 가 2회 실행됨.
 *  결과: canvas 이벤트 리스너 중복(4→8개), fxModule.init(d) 2회 호출.
 *  수정: acquire() 의 init() 호출 제거 — spawn() 에서 단일 호출로 통일.
 *
 *  로드 순서: 반드시 FX effect 스크립트보다 먼저 로드
 */

'use strict';

/* ═══════════════════════════════════════════════════════════
   § 0  CONSTANTS & UTILS
   ═══════════════════════════════════════════════════════════ */
const _TAU = 6.283185307179586;
const _DPR = Math.min(2, window.devicePixelRatio || 1);
const _clamp = (v, a, b) => v < a ? a : v > b ? b : v;

/* ═══════════════════════════════════════════════════════════
   § 1  DEMO-LITE  — makeDemo() 경량판 (FX/INT/AS/NV 계열용)
   ─────────────────────────────────────────────────────────
   기존 makeDemo와 동일한 'd' 구조.  fx.frame(d, dt_초) 호출.
   ═══════════════════════════════════════════════════════════ */
function _makeDemoLite(canvas, fxModule, id) {
  const ctx = canvas.getContext('2d');
  const d = {
    canvas, ctx, fx: fxModule, id: id || '?',
    W: 0, H: 0, t: 0,
    param: 0.5, burst: 0,
    fps: 0, fpsAcc: 0, fpsCnt: 0,
    mx: 0.5, my: 0.5, pmx: 0.5, pmy: 0.5,
    vmx: 0, vmy: 0, mOn: false, down: false,
    needResize: true, _err: 0, _dead: false,

    /** dt: seconds */
    tick(dt) {
      if (this.needResize) this._resize();
      if (this.W < 2 || this.H < 2) return;
      this.t = (this.t + dt) % 100000;
      if (this.burst > 0) this.burst = Math.max(0, this.burst - dt);
      this.vmx = this.mx - this.pmx;
      this.vmy = this.my - this.pmy;
      this.pmx = this.mx; this.pmy = this.my;
      try {
        this.fx.frame(this, dt);
        this._err = 0;
      } catch (e) {
        this._err++;
        if (this._err === 1) console.warn('[VFX] frame error', id, e && e.message);
        if (this._err >= 8) { this._dead = true; }
      }
      this.fpsAcc += dt * 1000;
      this.fpsCnt++;
      if (this.fpsAcc >= 500) {
        this.fps = Math.round(1000 * this.fpsCnt / this.fpsAcc);
        this.fpsAcc = 0; this.fpsCnt = 0;
      }
    },

    _resize() {
      const r = canvas.getBoundingClientRect();
      const w = Math.max(2, Math.floor((r.width || canvas.offsetWidth || 400) * _DPR));
      const h = Math.max(2, Math.floor((r.height || canvas.offsetHeight || 300) * _DPR));
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;
      this.W = w; this.H = h; this.needResize = false;
      if (this.fx.onResize) this.fx.onResize(this);
    }
  };

  // pointer (normalized 0~1)
  const _pos = e => {
    const r = canvas.getBoundingClientRect();
    d.mx = _clamp((e.clientX - r.left) / r.width, 0, 1);
    d.my = _clamp((e.clientY - r.top) / r.height, 0, 1);
  };
  canvas.addEventListener('pointermove', e => { _pos(e); d.mOn = true; }, { passive: true });
  canvas.addEventListener('pointerdown', e => { _pos(e); d.down = true; d.mOn = true; if (fxModule.onDown) try { fxModule.onDown(d); } catch (_) {} }, { passive: true });
  canvas.addEventListener('pointerup', () => { d.down = false; if (fxModule.onUp) try { fxModule.onUp(d); } catch (_) {} }, { passive: true });
  canvas.addEventListener('pointerleave', () => { d.mOn = false; d.down = false; }, { passive: true });

  if (fxModule && fxModule.init) {
    try { fxModule.init(d); }
    catch (e) { d._dead = true; console.warn('[VFX] init error', id, e && e.message); }
  }
  return d;
}

/* ═══════════════════════════════════════════════════════════
   § 2  EMI ADAPTERS
   ─────────────────────────────────────────────────────────
   모든 어댑터는 동일한 5-method EMI를 구현:
     init(ctx)          ctx = { canvas, W, H, DPR }
     update(dt, input)  dt = seconds; input = { mx, my, down, param, burst }
     render(ctx)        Canvas 2D는 update에서 이미 그림
     trigger(type, data)
     destroy()
   ═══════════════════════════════════════════════════════════ */

/**
 * wrapFX  — FX/INT/AS/NV 계열
 *   frame(d, dt_초) 패턴. _makeDemoLite 사용.
 */
function wrapFX(fxModule, id) {
  let _d = null;
  return {
    _type: 'FX',
    init(ctx) {
      _d = _makeDemoLite(ctx.canvas, fxModule, id || 'FX?');
      if (ctx.W) { _d.canvas.width = ctx.W; _d.canvas.height = ctx.H; _d.W = ctx.W; _d.H = ctx.H; _d.needResize = false; }
    },
    update(dt, input = {}) {
      if (!_d || _d._dead) return;
      if (input.mx !== undefined) _d.mx = input.mx;
      if (input.my !== undefined) _d.my = input.my;
      if (input.down !== undefined) _d.down = input.down;
      if (input.mOn !== undefined) _d.mOn = input.mOn;
      if (input.param !== undefined) _d.param = input.param;
      if (input.bg !== undefined) _d.bg = input.bg;   // [PATCH] 투명배경 모드 (S등급 63종에 추가된 d.bg===false 분기)
      if (input.burst > 0) { _d.burst = Math.max(_d.burst, input.burst); if (fxModule.onBurst) try { fxModule.onBurst(_d); } catch (_) {} }
      _d.tick(dt);
    },
    render() { /* Canvas 2D: already drawn in tick */ },
    trigger(type, data = {}) {
      if (!_d) return;
      if (type === 'burst') { _d.burst = data.intensity || 1.0; if (fxModule.onBurst) try { fxModule.onBurst(_d); } catch (_) {} }
      if (type === 'spawn') {
        if (data.x !== undefined) _d.mx = data.x;
        if (data.y !== undefined) _d.my = data.y;
        // [PATCH] 캐스트지점 API — S등급 전환 작업에서 각 모듈에 추가된 trigger(d,x,y)를 직접 호출.
        // 이게 없으면 d.mx/d.my만 바뀌고, cx=(d.tx!=null?d.tx:W/2) 식으로 redirect하는
        // 효과들은 위치가 전혀 안 바뀜(기존엔 DOM 클릭 이벤트로만 trigger가 불렸음).
        if (fxModule.trigger) try { fxModule.trigger(_d, data.x, data.y); } catch (_) {}
      }
      if (type === 'bg') _d.bg = data.value;   // [PATCH] 투명배경 모드를 spawn 시점에 한 번 설정할 때 사용
      if (type === 'param') _d.param = _clamp(data.value || 0.5, 0, 1);
      if (type === 'die') { if (fxModule.onDie) try { fxModule.onDie(_d); } catch (_) {} }
    },
    destroy() { if (_d && fxModule.destroy) try { fxModule.destroy(_d); } catch (_) {} _d = null; },
    get dead() { return !_d || _d._dead; }
  };
}

/**
 * wrapV5  — V5 계열
 *   draw(dt_프레임수, t_초) 패턴.
 *   게임 루프(초 단위) → 내부 변환: dt_sec * 60 = dt_frames.
 */
function wrapV5(makerFn, id) {
  let _eff = null, _t = 0;
  return {
    _type: 'V5',
    init(ctx) {
      _eff = makerFn(ctx.canvas);
      _eff.init();
      if (ctx.W) { ctx.canvas.width = ctx.W; ctx.canvas.height = ctx.H; }
      if (_eff.onResize) _eff.onResize();
    },
    update(dt /*, input */) {
      if (!_eff) return;
      _t += dt;
      const dtFrames = Math.min(dt * 60, 3); // seconds → frame-count (capped 3f)
      try { _eff.draw(dtFrames, _t); }
      catch (e) { console.warn('[VFX V5] draw error', id, e && e.message); }
    },
    render() {},
    trigger(/* type, data */) {},
    destroy() { if (_eff && _eff.cleanup) _eff.cleanup(); _eff = null; },
    get dead() { return !_eff; }
  };
}

/**
 * wrapOOP  — ARC/SW/GP 계열
 *   update(dt_초) + render() 패턴.
 *   ClassFn or instance. dt already in seconds.
 */
function wrapOOP(ClassFnOrInst, id, ...constructorArgs) {
  let _inst = null;
  return {
    _type: 'OOP',
    init(ctx) {
      if (typeof ClassFnOrInst === 'function') {
        _inst = new ClassFnOrInst(ctx.canvas, ...constructorArgs);
      } else {
        _inst = ClassFnOrInst;
      }
    },
    update(dt, input = {}) {
      if (!_inst) return;
      if (input.mx !== undefined && _inst.hmx !== undefined) { _inst.hmx = input.mx; _inst.hmy = input.my; }
      if (input.bg !== undefined) _inst.bg = input.bg;   // [PATCH] 투명배경 모드 (ARC 9종 render()의 this.bg===false 분기)
      try { _inst.update(dt); }
      catch (e) { console.warn('[VFX OOP] update error', id, e && e.message); }
    },
    render() {
      if (!_inst) return;
      try { _inst.render(); }
      catch (e) { console.warn('[VFX OOP] render error', id, e && e.message); }
    },
    trigger(type, data = {}) {
      if (!_inst) return;
      if (type === 'burst' || type === 'action') { if (_inst.action) try { _inst.action(); } catch (_) {} }
      // [PATCH] 캐스트지점 API — ARC 9종에 추가된 trigger(x,y) 메서드 호출(클래스 자체 캐스트 위치 이동).
      if (type === 'spawn') { if (_inst.trigger) try { _inst.trigger(data.x, data.y); } catch (_) {} }
      if (type === 'bg') _inst.bg = data.value;   // [PATCH]
    },
    destroy() { _inst = null; },
    get dead() { return !_inst; }
  };
}

/* ═══════════════════════════════════════════════════════════
   § 3  OBJECT POOL
   ─────────────────────────────────────────────────────────
   이펙트 인스턴스 재사용 풀.  생성/소멸 GC 비용 0.
   ═══════════════════════════════════════════════════════════ */
class EffectPool {
  constructor(factory, maxSize = 8) {
    this._factory = factory;
    this._maxSize = maxSize;
    this._free = [];    // available instances
    this._active = [];  // in-use instances
  }

  acquire(canvas, opts = {}) {
    let inst = this._free.pop();
    if (!inst) {
      inst = this._factory();
      // [BUG FIX] init은 spawn()에서 통합 호출 — 여기서 호출 시 _makeDemoLite가
      // 이벤트 리스너를 중복 등록하고 fxModule.init()이 두 번 실행됨.
      // (recycled 인스턴스는 acquire에서 init을 안 하므로, new/recycled 경로 통일)
    }
    inst._poolCanvas = canvas;
    inst._active = true;
    inst._opts = opts;
    this._active.push(inst);
    return inst;
  }

  release(inst) {
    const i = this._active.indexOf(inst);
    if (i !== -1) this._active.splice(i, 1);
    inst._active = false;
    if (this._free.length < this._maxSize) this._free.push(inst);
    else if (inst.destroy) inst.destroy();
  }

  updateAll(dt, input) {
    for (let i = this._active.length - 1; i >= 0; i--) {
      const inst = this._active[i];
      if (inst.dead) { this.release(inst); continue; }
      inst.update(dt, input || inst._opts);
    }
  }
}

/* ═══════════════════════════════════════════════════════════
   § 4  VFX REGISTRY + GAME API
   ─────────────────────────────────────────────────────────
   window.VFX 전역 싱글톤.
   효과를 이름으로 등록하고, spawn으로 인스턴스 생성.
   ═══════════════════════════════════════════════════════════ */
const VFX = (() => {
  // name → { factory, type, pool? }
  const _registry = new Map();
  // active handles [{ emi, canvas, name }]
  const _active = [];

  /* ── register ──────────────────────────────────────────── */
  /**
   * VFX.register(name, module, type, dpr?)
   *   name   : 'FX12' | 'NV-01' | 'V5-03' | ...
   *   module : fxModule object OR V5 makerFn OR OOP class
   *   type   : 'FX' | 'V5' | 'OOP'  (default: 'FX')
   *   poolMax: max pool size (default 8)
   */
  function register(name, module, type = 'FX', poolMax = 8) {
    let factory;
    if (type === 'V5') {
      factory = () => wrapV5(module, name);
    } else if (type === 'OOP') {
      factory = (...args) => wrapOOP(module, name, ...args);
    } else {
      factory = () => wrapFX(module, name);
    }
    _registry.set(name, { factory, type, pool: new EffectPool(factory, poolMax) });
  }

  /* ── spawn ─────────────────────────────────────────────── */
  /**
   * VFX.spawn(name, opts)
   *   opts.canvas  : HTMLCanvasElement (필수 or auto-created)
   *   opts.container : HTMLElement — canvas 자동 생성 시 부모
   *   opts.w, opts.h : canvas 크기 (px, default 400×300)
   *   opts.x, opts.y : 0~1 정규화 배치 (container 기준)
   *   opts.param     : 0~1 initial param
   *
   *  반환: handle { update, trigger, destroy, canvas }
   */
  function spawn(name, opts = {}) {
    const reg = _registry.get(name);
    if (!reg) { console.warn('[VFX] unknown effect:', name); return null; }

    // canvas 준비
    let canvas = opts.canvas;
    if (!canvas) {
      canvas = document.createElement('canvas');
      const w = opts.w || 400, h = opts.h || 300;
      canvas.width = Math.floor(w * _DPR);
      canvas.height = Math.floor(h * _DPR);
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      if (opts.container) {
        const con = opts.container;
        canvas.style.position = 'absolute';
        canvas.style.left = (((opts.x || 0.5) * con.clientWidth) - w * 0.5) + 'px';
        canvas.style.top = (((opts.y || 0.5) * con.clientHeight) - h * 0.5) + 'px';
        con.appendChild(canvas);
      }
    }

    // EMI instance
    const emi = reg.pool.acquire(canvas, opts);
    emi.init({ canvas, W: canvas.width, H: canvas.height, DPR: _DPR });
    if (opts.param !== undefined) emi.trigger('param', { value: opts.param });
    if (opts.bg !== undefined) emi.trigger('bg', { value: opts.bg });   // [PATCH] 스폰 시점에 투명배경 모드 지정

    const handle = {
      name, canvas, emi,
      update(dt, input) { emi.update(dt, input); },
      render() { emi.render(); },
      trigger(type, data) { emi.trigger(type, data); },
      destroy() {
        const i = _active.indexOf(handle);
        if (i !== -1) _active.splice(i, 1);
        reg.pool.release(emi);
        if (canvas.parentNode && !opts.canvas) canvas.parentNode.removeChild(canvas);
      },
      get dead() { return emi.dead; }
    };

    _active.push(handle);
    return handle;
  }

  /* ── updateAll ─────────────────────────────────────────── */
  /**
   * VFX.updateAll(dt)
   *   게임 메인 루프에서 호출. dt = seconds.
   *   dead 핸들 자동 정리.
   */
  function updateAll(dt) {
    for (let i = _active.length - 1; i >= 0; i--) {
      const h = _active[i];
      if (h.dead) { _active.splice(i, 1); continue; }
      h.update(dt);
    }
  }

  /* ── renderCanvas2D ────────────────────────────────────── */
  /**
   * VFX.renderCanvas2D(dt)
   *   Canvas 2D 이펙트는 update에서 이미 렌더됨 (no-op placeholder).
   *   WebGL OOP 이펙트 render() 호출이 필요한 경우 여기서.
   */
  function renderCanvas2D() {
    for (const h of _active) {
      if (!h.dead && h.emi._type === 'OOP') h.render();
    }
  }

  /* ── despawnAll ────────────────────────────────────────── */
  function despawnAll() {
    while (_active.length) _active[0].destroy();
  }

  /* ── internal: bulk-register from IIFE hooks ───────────── */
  /**
   * VFX._bulkFX(map)  — Part I IIFE 끝에서 호출
   *   map = { 'FX01': FX1, 'FX12': FX12, ... }
   */
  function _bulkFX(map) {
    for (const [name, mod] of Object.entries(map)) {
      register(name, mod, 'FX');
    }
  }

  /**
   * VFX._bulkV5(map)  — V5 계열
   *   map = { 'V5-01': v5_m1, ... }
   */
  function _bulkV5(map) {
    for (const [name, maker] of Object.entries(map)) {
      register(name, maker, 'V5');
    }
  }

  /**
   * VFX._bulkOOP(map)  — ARC/SW/GP 계열
   *   map = { 'ARC48': SomeClass, ... }
   */
  function _bulkOOP(map) {
    for (const [name, cls] of Object.entries(map)) {
      register(name, cls, 'OOP');
    }
  }

  /* ── debug ─────────────────────────────────────────────── */
  function list() {
    return Array.from(_registry.keys());
  }

  return {
    register, spawn, updateAll, renderCanvas2D, despawnAll, list,
    _bulkFX, _bulkV5, _bulkOOP,
    _getRegistry: () => _registry,  // internal — for _bulkSW/_bulkGP
    // expose adapters for manual use
    wrapFX, wrapV5, wrapOOP
  };
})();

/* ═══════════════════════════════════════════════════════════
   § 10  ONE-SHOT ADAPTER  — AC/SK/SC 계열
   ─────────────────────────────────────────────────────────
   skillFn(canvas, onDone?) → stopFn  패턴.
   trigger('play') 로 실행. 자동 정지 콜백 지원.
   ═══════════════════════════════════════════════════════════ */
function wrapOneShot(skillFn, id) {
  let _canvas = null, _stop = null, _onComplete = null;
  return {
    _type: 'ONESHOT',
    init(ctx) { _canvas = ctx.canvas; },
    update(/* dt */) {},   // one-shot drives its own internal RAF
    render() {},
    trigger(type, data = {}) {
      if (type === 'play' || type === 'burst') {
        if (_stop) { _stop(); _stop = null; }
        _onComplete = data.onComplete || null;
        try {
          // [PATCH] AC(sk1,sk5)·SC(scFns[N])는 (canvas, onDone, castX, castY, bg) 시그니처를 받음.
          // 기존엔 onDone만 전달돼서 캐스트지점/투명배경이 게임 쪽에서 절대 전달될 수 없었음.
          _stop = skillFn(_canvas, () => {
            _stop = null;
            if (_onComplete) _onComplete();
          }, data.x, data.y, data.bg);
        } catch(e) { console.warn('[VFX ONESHOT] error', id, e && e.message); }
      }
      if (type === 'stop') { if (_stop) { _stop(); _stop = null; } }
    },
    destroy() { if (_stop) { _stop(); _stop = null; } _canvas = null; },
    get dead() { return false; }
  };
}

/* ═══════════════════════════════════════════════════════════
   § 11  ALIAS + BULK ALIAS  — 이름 별칭 등록
   ─────────────────────────────────────────────────────────
   VFX.alias('AS-03', 'AS28')  →  'AS-03' spawn → same factory as 'AS28'
   ═══════════════════════════════════════════════════════════ */
VFX.alias = function(aliasName, canonicalName) {
  const registry = VFX._getRegistry();
  const canonical = registry.get(canonicalName);
  if (!canonical) {
    console.warn('[VFX] alias: canonical not found:', canonicalName);
    return;
  }
  // Alias shares the SAME pool as canonical (object pool efficiency)
  registry.set(aliasName, canonical);
};

VFX._bulkAlias = function(aliasMap) {
  // aliasMap = { 'alias-name': 'canonical-name', ... }
  for (const [alias, canonical] of Object.entries(aliasMap)) {
    VFX.alias(alias, canonical);
  }
};

VFX._bulkOneShot = function(nameToFnMap) {
  // nameToFnMap = { 'AC-01': sk1, 'SC-01': scFns[1], ... }
  const registry = VFX._getRegistry();
  for (const [name, fn] of Object.entries(nameToFnMap)) {
    const factory = () => wrapOneShot(fn, name);
    registry.set(name, { factory, type: 'ONESHOT', pool: new EffectPool(factory, 2) });
  }
};

/* ── expose globals ──────────────────────────────────────── */
window.VFX = VFX;
window.wrapFX = wrapFX;
window.wrapV5 = wrapV5;
window.wrapOOP = wrapOOP;
window.wrapOneShot = wrapOneShot;

/* ── Integration usage example (remove in production) ─────── */
/*
  // 1. 등록 (각 IIFE 끝 또는 DOMContentLoaded 후)
  VFX._bulkFX({
    'FX12': FX12,   // 태양 플레어 링
    'FX16': FX16,   // 블랙홀 특이점
    'FX05': FX5,    // 이벤트 호라이즌
  });
  VFX._bulkV5({
    'V5-01': v5_m1, // Kinetic Typography
  });

  // 2. 게임 루프
  let last = performance.now();
  function gameLoop(now) {
    const dt = Math.min((now - last) * 0.001, 0.05);
    last = now;
    updateGameLogic(dt);
    VFX.updateAll(dt);      // ← 모든 VFX 업데이트
    renderer.render();      // WebGL render
    VFX.renderCanvas2D();   // OOP render (ARC/SW/GP)
    requestAnimationFrame(gameLoop);
  }
  requestAnimationFrame(gameLoop);

  // 3. 이펙트 발동
  const hit = VFX.spawn('FX12', { container: document.getElementById('vfx-layer'), x: 0.5, y: 0.3, bg: false });
  // bg:false → 효과 자신의 배경(단색/그라디언트/잔상페이드)을 생략, 3D 장면 위에 투명 합성.
  hit.trigger('spawn', { x: 480, y: 260 });  // 캐스트지점(canvas px) — 각 효과의 trigger(d,x,y)를 직접 호출
  hit.trigger('burst', { intensity: 2.0 });

  // AC/SC(ONESHOT) 계열은 캐스트지점·배경모드를 trigger 시점에 같이 넘긴다:
  const sc = VFX.spawn('SC-01', { container: document.getElementById('vfx-layer') });
  sc.trigger('play', { x: 480, y: 260, bg: false });

  // 4. 정리
  hit.destroy();
*/

/* ═══════════════════════════════════════════════════════════
   § 5  COORD UTILS  — 좌표 정규화 유틸
   ─────────────────────────────────────────────────────────
   모든 이펙트는 (0~1, 0~1) 정규화 좌표로 위치를 받는다.
   내부에서 px 변환. 해상도 변경 시 자동 대응.
   ═══════════════════════════════════════════════════════════ */
const VFXCoords = {
  /**
   * normToPx(nx, ny, canvas) → { x, y } in pixel (DPR applied)
   * nx, ny : 0~1 normalized (left-top origin, y down)
   */
  normToPx(nx, ny, canvas) {
    return { x: nx * canvas.width, y: ny * canvas.height };
  },

  /**
   * pxToNorm(px, py, canvas) → { x, y } 0~1
   */
  pxToNorm(px, py, canvas) {
    return { x: canvas.width ? px / canvas.width : 0,
             y: canvas.height ? py / canvas.height : 0 };
  },

  /**
   * clientToNorm(clientX, clientY, element) → { x, y } 0~1
   * pointer event → effect input
   */
  clientToNorm(clientX, clientY, element) {
    const r = element.getBoundingClientRect();
    return {
      x: _clamp((clientX - r.left) / r.width, 0, 1),
      y: _clamp((clientY - r.top) / r.height, 0, 1)
    };
  },

  /**
   * worldToNorm(worldX, worldY, camMatrix, W, H) → { x, y } 0~1
   * 게임 월드 좌표 → 화면 정규화 좌표
   * camMatrix : 4×4 column-major Float32Array (MVP)
   */
  worldToNorm(wx, wy, wz = 0, camMatrix, W, H) {
    if (!camMatrix) throw new Error('[VFXCoords] camMatrix required');
    const m = camMatrix;
    const x = m[0]*wx + m[4]*wy + m[8]*wz  + m[12];
    const y = m[1]*wx + m[5]*wy + m[9]*wz  + m[13];
    const w = m[3]*wx + m[7]*wy + m[11]*wz + m[15];
    const ndcX = x / w;
    const ndcY = y / w;
    return {
      x: _clamp((ndcX + 1) * 0.5, 0, 1),
      y: _clamp((1 - ndcY) * 0.5, 0, 1)  // NDC Y-up → screen Y-down
    };
  }
};

/* ═══════════════════════════════════════════════════════════
   § 6  LAYER STACK  — CSS z-index 멀티 레이어
   ─────────────────────────────────────────────────────────
   VFX.createGameLayer(container, opts) → layerEl
   Option A (권장): CSS absolute 레이어 5개.
   ═══════════════════════════════════════════════════════════ */
function createGameLayer(container, opts = {}) {
  const layers = {
    BG:      { z: 0,  label: 'bg',       type: opts.bgType      || 'webgl2' },
    WORLD:   { z: 10, label: 'world',    type: opts.worldType   || 'webgl2' },
    VFX:     { z: 20, label: 'vfx',      type: opts.vfxType     || 'canvas2d' },
    SCREEN:  { z: 30, label: 'screen',   type: opts.screenType  || 'webgl2' },
    HUD:     { z: 40, label: 'hud',      type: opts.hudType     || 'canvas2d' },
  };

  // Container must be position:relative or absolute
  const cs = window.getComputedStyle(container);
  if (cs.position === 'static') container.style.position = 'relative';

  const result = {};
  for (const [key, cfg] of Object.entries(layers)) {
    const cv = document.createElement('canvas');
    cv.setAttribute('data-vfx-layer', cfg.label);
    cv.style.cssText = [
      'position:absolute',
      'inset:0',
      'width:100%',
      'height:100%',
      `z-index:${cfg.z}`,
      'pointer-events:none',
    ].join(';');
    // only VFX layer intercepts pointer by default
    if (key === 'WORLD') cv.style.pointerEvents = 'auto';
    cv.width  = Math.floor(container.offsetWidth  * _DPR);
    cv.height = Math.floor(container.offsetHeight * _DPR);
    container.appendChild(cv);
    result[key] = cv;
  }

  // Resize observer — keep all layers in sync
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      for (const cv of Object.values(result)) {
        cv.width  = Math.floor(width  * _DPR);
        cv.height = Math.floor(height * _DPR);
      }
    }).observe(container);
  }

  return result;  // { BG, WORLD, VFX, SCREEN, HUD } → each is <canvas>
}

/* ═══════════════════════════════════════════════════════════
   § 7  GAME LOOP FACTORY
   ─────────────────────────────────────────────────────────
   VFX.createGameLoop(tickFn) → { start, stop, running }
   tickFn(dt_seconds) called every frame.
   dt clamped to 50ms (= 20fps floor).
   ═══════════════════════════════════════════════════════════ */
function createGameLoop(tickFn) {
  let _last = 0, _raf = 0;
  const _DT_MAX = 0.05; // 50ms clamp

  function _frame(now) {
    const dt = _last ? Math.min((now - _last) * 0.001, _DT_MAX) : 0;
    _last = now;
    try { tickFn(dt); } catch (e) { console.error('[VFX GameLoop] tick error:', e); stop(); return; }
    _raf = requestAnimationFrame(_frame);
  }

  function start() {
    if (_raf) return;
    _last = performance.now();
    _raf = requestAnimationFrame(_frame);
  }

  function stop() {
    if (_raf) { cancelAnimationFrame(_raf); _raf = 0; }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop();
    else if (_last) start(); // only auto-resume if was running
  }, { passive: true });

  return { start, stop, get running() { return !!_raf; } };
}

/* ═══════════════════════════════════════════════════════════
   § 8  POOL AUTO-RETURN — maxAge + _done flag
   ─────────────────────────────────────────────────────────
   Pool에 maxAge(초) 옵션 추가.  초과 시 자동 반납.
   또는 handle.done() 호출로 수동 완료 표시.
   ═══════════════════════════════════════════════════════════ */
// Extend spawn() to support maxAge
const _origSpawn = VFX.spawn.bind(VFX);
VFX.spawn = function(name, opts = {}) {
  const handle = _origSpawn(name, opts);
  if (!handle) return null;
  const maxAge = opts.maxAge; // seconds, optional
  let _age = 0, _done = false;

  const _origUpdate = handle.update.bind(handle);
  handle.update = function(dt, input) {
    if (_done) return;
    _origUpdate(dt, input);
    if (maxAge !== undefined) {
      _age += dt;
      if (_age >= maxAge) handle.destroy();
    }
  };

  handle.markDone = function() { _done = true; handle.destroy(); };
  return handle;
};

/* ═══════════════════════════════════════════════════════════
   § 9  SW/GP BULK HELPERS  — §4 bulkFX 패턴 확장
   ═══════════════════════════════════════════════════════════ */
/**
 * VFX._bulkSW(nameToFragMap, SWEffectClass)
 *   nameToFragMap = { 'SW-01': 'SW01', ... }
 */
VFX._bulkSW = function(nameToFragMap, SWEffectClass) {
  const registry = VFX._getRegistry();
  for (const [name, fragKey] of Object.entries(nameToFragMap)) {
    const fk = fragKey;
    const factory = () => wrapOOP(SWEffectClass, name, fk);
    registry.set(name, { factory, type: 'OOP', pool: new EffectPool(factory, 4) });
  }
  console.log('[VFX] _bulkSW registered:', Object.keys(nameToFragMap).length);
};

/**
 * VFX._bulkGP(nameToClassMap)
 *   nameToClassMap = { 'GP-01': { cls: GPVoidNebula, pal: 0 }, ... }
 */
VFX._bulkGP = function(nameToClassMap) {
  const registry = VFX._getRegistry();
  for (const [name, cfg] of Object.entries(nameToClassMap)) {
    const cls = cfg.cls, pal = cfg.pal;
    const factory = () => wrapOOP(cls, name, pal);
    registry.set(name, { factory, type: 'OOP', pool: new EffectPool(factory, 2) });
  }
  console.log('[VFX] _bulkGP registered:', Object.keys(nameToClassMap).length);
};

/* expose new APIs */
Object.assign(VFX, { createGameLayer, createGameLoop });
window.VFXCoords = VFXCoords;

/* [ESM] export registry singleton — main game: import { VFX } from './vfx-game-integration.js' */
export { VFX };


/* ===== [2] merged Canvas2D 효과 ===== */
/* ════════════════════════════════════════════════════════════════
   vfx-effects-merged.js  ── GlobeStriker VFX 효과 번들 (Canvas2D)
   출처: VFX-merged-v41 / 블록[1420-6972] 순수 Canvas2D (webgl=0)
   self-register → window.VFX (먼저 vfx-game-integration.js 로드 필수)
   제외: WebGL r128 계열(ARC / SW / GP) — r160 충돌, 별도 P3
   변경: 갤러리 RAF 킥스타트 1줄 + visibilitychange 무력화(게임 불필요)
   ════════════════════════════════════════════════════════════════ */
(function(){

/* ============================================================================
   GAME EXTRACTION GUIDE  —  단일 HTML 게임으로 이펙트 떼어가는 법
   ----------------------------------------------------------------------------
   갤러리는 그대로. 게임엔 [커널 1블록] + [원하는 이펙트 블록]만 복붙.

   1) 커널 복사: 아래 KERNEL-START … KERNEL-END 사이 전체
      (helpers TAU/sd/hsl/rnd/clamp/rot + makeDemo + safeStep + loop).
   2) 이펙트 복사: 원하는  const FXn = (function(){ ... })();  블록 하나.
      ( 각 모듈은 "===== FXn =====" 헤더 주석으로 구획되어 있음 )
      INT 계열은 [해당 class] + [intFX_INTn 래퍼] 한 쌍을 같이 복사.
   3) 구동:  const d = makeDemo(canvasEl, FXn);  d.visible = true;
      - 매 프레임 loop가 d.frame(d, dt초) 호출(가시성 게이트·dt클램프 내장).
      - 게임 트리거:  d.burst = 1 (액션) ·  d.param = 0~1 (강도) ·
        d.mx / d.my (px) + d.mOn (마우스·월드 좌표를 직접 주입).
      - 갤러리 배선(IntersectionObserver·슬라이더·data-* 속성)은 게임엔 불필요.

   d 계약(이펙트가 보는 값):
      ctx, W, H(px·DPR적용), t(초), param(0~1), burst(0~1·당신이 세팅),
      mx, my(px), mOn(bool).   init(d) 1회  →  frame(d, dt) 매 프레임.

   드롭인 가능: PART I(FX1~30) · PART VII(INT: class+wrapper) ·
              PART VIII(ASTRAL — 자체 트윈 커널 사용: 그쪽 커널을 복사).
   개별 포팅(시퀀스형): PART III(MC) · IV(AC) · VI(SC) — 루프 모듈이 아니라
              일회성 연출 시퀀스. 해당 함수 + 러너를 통째로 떼어갈 것.

   [주의] 예약명 금지 — 이펙트 상태는 d.(고유명)에만 저장.
      다음은 커널 전용이라 덮어쓰면 깨짐:
      fx, ctx, canvas, W, H, t, param, burst, mx, my, mOn, hud, id,
      playing, visible, needResize, fps, step, resize.
      (AS-10이 d.fx를 파편배열로 덮어써 safe-mode 되었던 사례 참고.)
      class 내부의 this.* 상태는 무관.
   ============================================================================ */

  /* KERNEL-START  ── 게임에 복사할 최소 커널: 여기부터 ── */
  const DPR=Math.min(2,window.devicePixelRatio||1);
  const demos=[]; const TAU=6.28318530718;
  const PI2=TAU;
  const rand=(a,b)=>a+Math.random()*(b-a);
  const clamp=(v,a,b)=>v<a?a:v>b?b:v;

  function makeDemo(canvas,fx){
    const ctx=canvas.getContext("2d");
    const d={canvas,ctx,fx,playing:true,visible:false,needResize:true,
      W:0,H:0,t:0,param:0.5,burst:0,fps:0,fpsAcc:0,fpsCnt:0,hud:null,mx:0,my:0,mOn:false,
      step(dt){
        if(this.needResize) this.resize();
        if(this.W<2||this.H<2) return;
        this.t=(this.t+dt*0.001)%100000;
        if(this.burst>0) this.burst=Math.max(0,this.burst-dt*0.001);
        this.fx.frame(this,dt*0.001);
        this.fpsAcc+=dt; this.fpsCnt++;
        if(this.fpsAcc>=500){this.fps=Math.round(1000*this.fpsCnt/this.fpsAcc);this.fpsAcc=0;this.fpsCnt=0;
          if(this.hud&&this.fx.hud) this.hud.textContent=this.fx.hud(this);}
      },
      resize(){
        const r=canvas.getBoundingClientRect();
        const w=Math.max(2,Math.floor(r.width*DPR)),h=Math.max(2,Math.floor(r.height*DPR));
        if(canvas.width!==w) canvas.width=w;
        if(canvas.height!==h) canvas.height=h;
        this.W=w;this.H=h;this.needResize=false;
        if(this.fx.onResize) this.fx.onResize(this);
      }};
    if(fx&&fx.init){ try{ fx.init(d); }catch(e){ d._dead=true; console.warn("[VFX] init error:",e&&e.message); } }
    return d;
  }
  let last=performance.now();
  /* [Fix v6-S21] BUG-PREVENTION SYSTEM
     ① FX 격리: step() try-catch → 한 FX 에러가 엔진 전체를 죽이지 않음
     ② 반복 실패 시 해당 FX 자동 비활성 (콘솔/CPU 폭주 차단)
     ③ document.hidden + visible 게이트로 비가시 FX 완전 정지 (재생 누적 방지)
     ④ dt 상한 클램프(40ms)로 탭 복귀 시 물리 폭주 차단 */
  function safeStep(d,dt){
    try{ d.step(dt); d._err=0; }
    catch(e){
      d._err=(d._err||0)+1;
      if(d._err===1) console.warn("[VFX] FX#"+d.id+" step error:",e&&e.message);
      if(d._err>=8){ d.playing=false; d._dead=true;
        try{ const cc=d.ctx; cc.fillStyle="#0a0008"; cc.fillRect(0,0,d.W,d.H);
          cc.fillStyle="rgba(255,90,110,.7)"; cc.font="12px monospace"; cc.textAlign="center";
          cc.fillText("FX#"+d.id+" disabled (safe-mode)",d.W/2,d.H/2);}catch(_){} }
    }
  }
  let _rafId=0;
  Object.defineProperty(window,'_rafId',{get:()=>_rafId,set:v=>{_rafId=v;},configurable:true});
  function loop(now){
    let dt=now-last; last=now; if(dt>40) dt=40;
    if(!document.hidden){
      /* [FIX] _dead 항목을 루프 내에서 즉시 제거 — 좀비 순회 누적 방지 */
      for(let i=demos.length-1;i>=0;i--){
        const d=demos[i];
        if(d._dead){demos.splice(i,1);continue;}
        if(d.playing&&d.visible){ safeStep(d,dt); if(d._dead) demos.splice(i,1); }
      }
    }
    _rafId=requestAnimationFrame(loop);
  }
  /* [GAME] 갤러리 RAF 킥스타트 비활성 — 게임은 자체 animate() 사용 */
  // _rafId=requestAnimationFrame(loop);
  // 페이지 숨김 시 RAF 완전 정지 → 복귀 시 단일 재개 (재생 누적/누수 차단)
  /* [GAME] visibilitychange 갤러리 RAF 제어 비활성 */

  function rot(v,i,j,a){const c=Math.cos(a),s=Math.sin(a),vi=v[i],vj=v[j];v[i]=vi*c-vj*s;v[j]=vi*s+vj*c;}
  function sd(s){s=Math.sin(s*127.1)*43758.5453;return s-Math.floor(s);}
  function hsl(h,s,l,a){return"hsla("+((h%360+360)%360)+","+s+"%,"+l+"%,"+a+")";}

  /* KERNEL-END  ── 커널 끝. 아래부터 개별 이펙트 모듈(자유 복붙) ── */

  /* ===== FX1 ===== */
  const FX1=(function(){
    const OCT=[[1,0,0,0],[-1,0,0,0],[0,1,0,0],[0,-1,0,0],[0,0,1,0],[0,0,-1,0]];
    const OE=[[0,2],[0,3],[0,4],[0,5],[1,2],[1,3],[1,4],[1,5],[2,4],[2,5],[3,4],[3,5]];
    const TS=[],TE=[];for(let i=0;i<16;i++)TS.push([(i&1?1:-1),(i&2?1:-1),(i&4?1:-1),(i&8?1:-1)]);
    for(let a=0;a<16;a++)for(let b=a+1;b<16;b++){let f=0;for(let k=0;k<4;k++)if(TS[a][k]!==TS[b][k])f++;if(f===1)TE.push([a,b]);}
    const P=[0,0,0,0],PA=new Float32Array(64),PB=new Float32Array(64);
    function pj(s,o,n,ax,ay,az,aw,sc,cx,cy){for(let i=0;i<n;i++){P[0]=s[i][0];P[1]=s[i][1];P[2]=s[i][2];P[3]=s[i][3];rot(P,0,3,aw);rot(P,1,2,az);rot(P,0,1,ax);rot(P,1,3,ay);const k4=3/Math.max(0.05,3-P[3]);let x=P[0]*k4,y=P[1]*k4,z=P[2]*k4;const k3=4/Math.max(0.05,4.2-z);o[i*2]=cx+x*k3*sc;o[i*2+1]=cy+y*k3*sc;}}
    function eg(c,p,e,col,al,lw){c.lineWidth=lw;c.strokeStyle=col;c.globalAlpha=al;c.shadowColor=col;c.shadowBlur=14;c.beginPath();for(let i=0;i<e.length;i++){const a=e[i][0],b=e[i][1];c.moveTo(p[a*2],p[a*2+1]);c.lineTo(p[b*2],p[b*2+1]);}c.stroke();c.shadowBlur=0;c.globalAlpha=1;}
    return{init(d){if(!d._castBound){d._castBound=e=>{const r=d.canvas.getBoundingClientRect();this.trigger(d,(e.clientX-r.left)*DPR,(e.clientY-r.top)*DPR);};d.canvas.addEventListener('click',d._castBound);}},trigger(d,x,y){d.tx=x;d.ty=y;},frame(d){const c=d.ctx,W=d.W,H=d.H,cx=(d.tx!=null?d.tx:W/2),cy=(d.ty!=null?d.ty:H/2),T=d.t;if(d.bg===false){c.clearRect(0,0,W,H);}else{const g=c.createRadialGradient(cx,cy,0,cx,cy,Math.max(W,H)*.7);g.addColorStop(0,"#0a1430");g.addColorStop(1,"#04060f");c.fillStyle=g;c.fillRect(0,0,W,H);}c.save();c.globalCompositeOperation="lighter";const m=(Math.sin(T*.35)+1)/2,dp=Math.round(d.param*2)+1,b=Math.min(W,H)*.3,ax=T*.5,ay=T*.32,az=T*.21+d.burst*4,aw=T*.6+d.burst*3;for(let l=0;l<dp;l++){const s=Math.pow(.46,l),al=l===0?1:.3/l;if(m<.97){pj(OCT,PA,6,ax,ay,az,aw,b*s,cx,cy);eg(c,PA,OE,"#5ec8ff",(1-m)*al,l?1.4:2.6);}if(m>.03){pj(TS,PB,16,ax,ay,az,aw,b*.78*s,cx,cy);eg(c,PB,TE,"#9affe8",m*al,l?1.2:2);}}const cu=m<.5?PA:PB,cn=m<.5?6:16;c.fillStyle="#fff";for(let i=0;i<cn;i++){c.globalAlpha=.8;c.beginPath();c.arc(cu[i*2],cu[i*2+1],m<.5?2.6:1.8,0,TAU);c.fill();}c.restore();},hud(d){return(((Math.sin(d.t*.35)+1)/2)<.5?"OCTA":"TESSERACT")+" · "+d.fps+"FPS";}};
  })();

  /* ===== FX2 ===== */
  const FX2=(function(){
    const V=[];for(let i=0;i<16;i++)V.push([(i&1?1:-1),(i&2?1:-1),(i&4?1:-1),(i&8?1:-1)]);
    const E=[];for(let a=0;a<16;a++)for(let b=a+1;b<16;b++){let f=0;for(let k=0;k<4;k++)if(V[a][k]!==V[b][k])f++;if(f===1)E.push([a,b]);}
    const P=[0,0,0,0],PT=new Float32Array(32),CY=[62,232,255],OR=[255,138,61];
    function pj(ax,ay,az,aw,sc,cx,cy,ox,oy){for(let i=0;i<16;i++){P[0]=V[i][0];P[1]=V[i][1];P[2]=V[i][2];P[3]=V[i][3];rot(P,0,3,aw);rot(P,1,3,az);rot(P,0,1,ax);rot(P,2,3,ay);const k4=3/Math.max(0.05,3-P[3]);let x=P[0]*k4,y=P[1]*k4,z=P[2]*k4;const k3=4/Math.max(0.05,4.4-z);PT[i*2]=cx+ox+x*k3*sc;PT[i*2+1]=cy+oy+y*k3*sc;}}
    function lc(a,b,t){return"rgb("+Math.round(a[0]+(b[0]-a[0])*t)+","+Math.round(a[1]+(b[1]-a[1])*t)+","+Math.round(a[2]+(b[2]-a[2])*t)+")";}
    return{init(d){if(!d._castBound){d._castBound=e=>{const r=d.canvas.getBoundingClientRect();this.trigger(d,(e.clientX-r.left)*DPR,(e.clientY-r.top)*DPR);};d.canvas.addEventListener('click',d._castBound);}},
    trigger(d,x,y){d.tx=x;d.ty=y;},
    frame(d){const c=d.ctx,W=d.W,H=d.H,cx=(d.tx!=null?d.tx:W/2),cy=(d.ty!=null?d.ty:H/2),T=d.t;if(d.bg===false){c.clearRect(0,0,W,H);}else{const g=c.createRadialGradient(cx,cy+H*.05,0,cx,cy,Math.max(W,H));g.addColorStop(0,"#0c0d12");g.addColorStop(1,"#020203");c.fillStyle=g;c.fillRect(0,0,W,H);c.fillStyle="rgba(40,30,25,.35)";c.fillRect(0,H*.74,W,H*.26);}c.save();c.globalCompositeOperation="lighter";const dp=Math.round(d.param*2)+1,b=Math.min(W,H)*.26,ax=T*.45,ay=T*.28+d.burst*3,az=T*.19,aw=T*.55+d.burst*4,pu=(Math.sin(T*2)+1)/2;for(let l=0;l<dp;l++){const s=Math.pow(.42,l),ox=Math.sin(T*.6+l)*l*14,oy=Math.cos(T*.5+l)*l*10;pj(ax,ay,az,aw,b*s,cx,cy,ox,oy);c.globalAlpha=.05/(l+1);c.fillStyle="#7fd9ff";c.beginPath();c.moveTo(PT[0],PT[1]);for(let i=1;i<16;i++)c.lineTo(PT[i*2],PT[i*2+1]);c.closePath();c.fill();c.globalAlpha=1;const co=lc(CY,OR,(Math.sin(T*1.3+l*.9)+1)/2);c.strokeStyle=co;c.lineWidth=l?1.2:2.4;c.shadowColor=co;c.shadowBlur=10+pu*10;c.globalAlpha=l?.5:1;c.beginPath();for(let e=0;e<E.length;e++){const a=E[e][0],bb=E[e][1];c.moveTo(PT[a*2],PT[a*2+1]);c.lineTo(PT[bb*2],PT[bb*2+1]);}c.stroke();c.shadowBlur=0;c.globalAlpha=1;}c.restore();},hud(d){return"OBSIDIAN · R"+(Math.round(d.param*2)+1)+" · "+d.fps+"FPS";}};
  })();

  /* ===== FX3 ===== */
  const FX3=(function(){
    const G=[[[-.4,-.5,.4,-.5],[-.4,-.5,-.4,.5],[-.4,0,.3,0],[-.4,.5,.4,.5]],[[-.4,-.5,.4,-.5],[.4,-.5,.4,.5],[-.4,.5,.4,.5],[-.4,-.5,-.4,.5]],[[-.4,-.5,-.4,.5],[-.4,.5,.4,.5],[.2,-.5,.2,.5]],[[-.4,-.5,.4,.5],[.4,-.5,-.4,.5]],[[0,-.5,0,.5],[-.4,-.3,0,-.5],[.4,-.3,0,-.5]],[[-.4,-.5,.4,-.5],[0,-.5,0,.5],[-.3,.5,.3,.5]]];
    return{init(d){d.sh=[];for(let i=0;i<26;i++){d.sh.push({a:sd(i*1.7)*TAU,dist:.12+sd(i*3.1)*.42,sz:.03+sd(i*5.3)*.05,g:Math.floor(sd(i*7.7)*G.length),rot:(sd(i*9.1)-.5)*1.2,sp:.5+sd(i*11)*.8});}if(!d._castBound){d._castBound=e=>{const r=d.canvas.getBoundingClientRect();this.trigger(d,(e.clientX-r.left)*DPR,(e.clientY-r.top)*DPR);};d.canvas.addEventListener('click',d._castBound);}},
    trigger(d,x,y){d.tx=x;d.ty=y;},
    frame(d){const c=d.ctx,W=d.W,H=d.H,cx=(d.tx!=null?d.tx:W/2),cy=(d.ty!=null?d.ty:H/2),T=d.t;if(d.bg===false){c.clearRect(0,0,W,H);}else{c.fillStyle="#1c1d22";c.fillRect(0,0,W,H);c.fillStyle="rgba(255,255,255,.025)";for(let i=0;i<6;i++){const x=sd(i*2+Math.floor(T*.3))*W;c.fillRect(x,0,40,H);}}const br=(Math.sin(T*.9)+1)/2,ab=3+d.param*9+d.burst*14,ht=Math.round(d.param+d.burst),S=Math.min(W,H);c.save();c.globalCompositeOperation="screen";const ch=[["#00e5ff",-ab,0],["#ff2bd1",ab,ab*.4],["#fff04d",0,-ab]];for(let cc=0;cc<3;cc++){const o=ch[cc];c.strokeStyle=o[0];c.lineWidth=Math.max(1.4,S*.004);for(let i=0;i<d.sh.length;i++){const s=d.sh[i],dt=s.dist*br*Math.min(W,H),px=cx+Math.cos(s.a)*dt+o[1],py=cy+Math.sin(s.a)*dt+o[2],sz=s.sz*S*(.6+br*.8),rr=s.rot+T*s.sp*.4,cs=Math.cos(rr),sn=Math.sin(rr),gl=G[s.g];c.beginPath();for(let k=0;k<gl.length;k++){const sg=gl[k],x1=sg[0]*sz,y1=sg[1]*sz,x2=sg[2]*sz,y2=sg[3]*sz;c.moveTo(px+x1*cs-y1*sn,py+x1*sn+y1*cs);c.lineTo(px+x2*cs-y2*sn,py+x2*sn+y2*cs);}c.stroke();}}c.restore();if(ht>0){c.fillStyle="rgba(0,0,0,.2)";const gp=22,ph=T*40;for(let y=0;y<H;y+=gp)for(let x=0;x<W;x+=gp){const dx=x-cx,dy=y-cy,dd=Math.sqrt(dx*dx+dy*dy),r=1.5+2.6*(.5+.5*Math.sin(dd*.05-ph*.1))*br*ht;c.beginPath();c.arc(x,y,r,0,TAU);c.fill();}}
      // [Fix v5-F03] 중앙 흔들선 제거 — 글리치 컨셉 무관 노이즈 제거, 추가 글리프 파편으로 밀도 보완
      for(let i=0;i<4;i++){const fx=(sd(i*4.1+Math.floor(T*3)))*W,fy=(sd(i*6.7+Math.floor(T*2)))*H,fsz=S*(.02+sd(i*8.3)*.03);c.save();c.globalCompositeOperation="screen";c.strokeStyle="rgba(255,255,255,"+(.08+br*.12)+")";c.lineWidth=.8;const gk=G[Math.floor(sd(i+Math.floor(T)))*G.length|0]||G[0];const cs2=Math.cos(T*.8+i),sn2=Math.sin(T*.8+i);c.beginPath();for(let k=0;k<gk.length;k++){const sg=gk[k];c.moveTo(fx+sg[0]*fsz*cs2-sg[1]*fsz*sn2,fy+sg[0]*fsz*sn2+sg[1]*fsz*cs2);c.lineTo(fx+sg[2]*fsz*cs2-sg[3]*fsz*sn2,fy+sg[2]*fsz*sn2+sg[3]*fsz*cs2);}c.stroke();c.restore();}
    },hud(d){return"GLITCH · AB"+Math.round(3+d.param*9)+" · "+d.fps+"FPS";}};
  })();

  /* ===== FX4 LIQUID FIRE SLASH — [Fix v5-F04] 대폭개선 ===== */
  /* ① 베지어 3점 불규칙 경로 ② 중간최대·양끝뾰족 프로파일 ③ 3중 additive 블렌드 ④ 불씨 물리 */
  const FX4=(function(){
    const NE=24; // ember pool
    return{init(d){
      d.px=new Float32Array(80);d.py=new Float32Array(80);d.pl=new Float32Array(80);d.head=0;
      // bezier control points (randomized each cycle)
      d.bx0=0;d.by0=0;d.bx1=0;d.by1=0;d.bx2=0;d.by2=0;d.lastPh=0;
      // ember pool
      d.ex=new Float32Array(NE);d.ey=new Float32Array(NE);
      d.evx=new Float32Array(NE);d.evy=new Float32Array(NE);
      d.el=new Float32Array(NE);d.ei=0;
    },
    frame(d,dt){
      const c=d.ctx,W=d.W,H=d.H,cx=W/2,cy=H/2,T=d.t,S=Math.min(W,H);
      const per=2.1,ph=(T%per)/per,act=ph<.42,th=.5+d.param*1.4;
      // rebuild bezier once per cycle
      if(ph<d.lastPh||d.bx0===0){
        const spread=S*.38;
        d.bx0=cx+(sd(T*.3)-.5)*spread*2.1;d.by0=cy+(sd(T*.5+1)-.5)*spread*1.2;
        d.bx1=cx+(sd(T*.4+2)-.5)*spread*1.0;d.by1=cy+(sd(T*.6+3)-.5)*spread*1.8;
        d.bx2=cx+(sd(T*.2+4)-.5)*spread*2.0;d.by2=cy+(sd(T*.7+5)-.5)*spread*1.0;
      }
      d.lastPh=ph;
      for(let i=0;i<80;i++)if(d.pl[i]>0)d.pl[i]-=dt*2.4;
      if(act){
        const u=ph/.42;
        // sample bezier for ribbon points
        const bx=cx+(d.bx0-cx)*(1-u)*(1-u)+(d.bx1-cx)*2*(1-u)*u+(d.bx2-cx)*u*u;
        const by=cy+(d.by0-cy)*(1-u)*(1-u)+(d.by1-cy)*2*(1-u)*u+(d.by2-cy)*u*u;
        const wob=Math.sin(u*11+T*6)*.04;
        d.px[d.head]=bx+wob*S;d.py[d.head]=by;d.pl[d.head]=1;d.head=(d.head+1)%80;
        // spawn embers at tip
        if(u>.35&&Math.random()<.35){
          const j=d.ei;d.ei=(d.ei+1)%NE;
          const ea=Math.random()*TAU,esp=S*(.015+Math.random()*.04);
          d.ex[j]=bx;d.ey[j]=by;
          d.evx[j]=Math.cos(ea)*esp+(sd(j*1.3+T)-.5)*esp;
          d.evy[j]=Math.sin(ea)*esp-S*.008;d.el[j]=1;
        }
      }
      if(d.burst>.6){const u=(1-d.burst)/.4,bx2=d.bx0+(d.bx2-d.bx0)*u,by2=d.by0+(d.by2-d.by0)*u;
        d.px[d.head]=bx2;d.py[d.head]=by2;d.pl[d.head]=1;d.head=(d.head+1)%80;}
      // collect ribbon
      const ox=[],oy=[],ol=[];
      for(let s=0;s<80;s++){const i=(d.head+s)%80;if(d.pl[i]>0){ox.push(d.px[i]);oy.push(d.py[i]);ol.push(d.pl[i]);}}
      const M=ox.length;
      // BG — warm paper for ink visibility
      const bgG=c.createRadialGradient(cx,cy,0,cx,cy,Math.max(W,H)*.7);
      bgG.addColorStop(0,'#f0ece4');bgG.addColorStop(.5,'#e8e2d8');bgG.addColorStop(1,'#ddd8ce');
      c.fillStyle=bgG;c.fillRect(0,0,W,H);
      if(M>2){
        const tp=new Float32Array(M*2),bt=new Float32Array(M*2);
        for(let i=0;i<M;i++){
          const pa=Math.max(0,i-1),pb=Math.min(M-1,i+1);
          let tx=ox[pb]-ox[pa],ty=oy[pb]-oy[pa];
          const ln=Math.hypot(tx,ty)||1;tx/=ln;ty/=ln;
          const r=i/(M-1),ev=Math.sin(Math.PI*r)*Math.pow(Math.sin(Math.PI*r),1.6); // peak middle, taper ends
          const wb=Math.sin(r*14+T*6)*.2+1;
          const w=ev*ol[i]*S*(.065*th)*wb;
          tp[i*2]=ox[i]-ty*w;tp[i*2+1]=oy[i]+tx*w;
          bt[i*2]=ox[i]+ty*w;bt[i*2+1]=oy[i]-tx*w;
        }
        // [v8] multiply on light bg
        c.save();c.globalCompositeOperation="multiply";
        // rim glow — 황금
        c.beginPath();c.moveTo(tp[0],tp[1]);for(let i=1;i<M;i++)c.lineTo(tp[i*2],tp[i*2+1]);for(let i=M-1;i>=0;i--)c.lineTo(bt[i*2],bt[i*2+1]);c.closePath();
        const gl=c.createLinearGradient(ox[0],oy[0],ox[M-1],oy[M-1]);
        gl.addColorStop(0,"rgba(80,0,0,0)");gl.addColorStop(.2,"#3a0004");gl.addColorStop(.55,"#7a1000");gl.addColorStop(.8,"#ff8a1e");gl.addColorStop(1,"#ffd060");
        c.fillStyle=gl;c.fill();
        // mid — 주황 core
        c.lineWidth=S*.008;c.strokeStyle="rgba(255,120,30,.7)";c.shadowColor="#ff5a1e";c.shadowBlur=18;
        c.beginPath();c.moveTo(ox[0],oy[0]);for(let i=1;i<M;i++)c.lineTo(ox[i],oy[i]);c.stroke();
        // core — 백진
        c.lineWidth=S*.003;c.strokeStyle="rgba(255,240,160,.95)";c.shadowColor="#ffe060";c.shadowBlur=8;
        c.beginPath();c.moveTo(ox[0],oy[0]);for(let i=1;i<M;i++)c.lineTo(ox[i],oy[i]);c.stroke();
        c.shadowBlur=0;c.restore();
        // Ukiyo-e 먹선 (calligraphy taper)
        c.lineJoin="round";c.strokeStyle="rgba(0,0,0,.85)";
        c.lineWidth=S*.026*th*(1+Math.sin(T*2)*.04);
        c.beginPath();c.moveTo(tp[0],tp[1]);for(let i=1;i<M;i++)c.lineTo(tp[i*2],tp[i*2+1]);for(let i=M-1;i>=0;i--)c.lineTo(bt[i*2],bt[i*2+1]);c.closePath();c.stroke();
      }
      // [Fix v5-F04-④] 불씨 물리 시뮬 (gravity + drag)
      c.save();c.globalCompositeOperation="lighter";
      for(let j=0;j<NE;j++){if(d.el[j]>0){
        d.ex[j]+=d.evx[j];d.ey[j]+=d.evy[j];
        d.evy[j]+=S*.0004;d.evx[j]*=.95;d.evy[j]*=.95;
        d.el[j]-=dt*.9;
        const r=1+d.el[j]*3.5,al=Math.max(0,d.el[j])*.9;
        c.fillStyle="rgba(255,"+(100+d.el[j]*130|0)+",40,"+al+")";
        c.beginPath();c.arc(d.ex[j],d.ey[j],r,0,TAU);c.fill();
      }}
      c.restore();
    },hud(d){return"SLASH · liquid-fire · "+d.fps+"FPS";}};
  })();

  /* ===== FX5 ===== */
  const FX5=(function(){const N=480;return{init(d){d.a=new Float32Array(N);d.r=new Float32Array(N);d.sp=new Float32Array(N);d.k=new Float32Array(N);for(let i=0;i<N;i++){d.a[i]=sd(i)*TAU;d.r[i]=.25+sd(i*1.7)*.85;d.sp[i]=.6+sd(i*2.3)*.9;d.k[i]=sd(i*3.9)<.12?1:0;}},
    frame(d,dt){const c=d.ctx,W=d.W,H=d.H,cx=W/2,cy=H/2,T=d.t,S=Math.min(W,H);c.fillStyle="#040208";c.fillRect(0,0,W,H);const ng=c.createRadialGradient(cx,cy,0,cx,cy,S*.65);ng.addColorStop(0,"rgba(120,30,140,.3)");ng.addColorStop(.45,"rgba(70,20,110,.18)");ng.addColorStop(1,"rgba(5,2,10,0)");c.fillStyle=ng;c.fillRect(0,0,W,H);const pl=(.55+d.param*1.2+d.burst*1.6)*dt,cr=S*.1;c.save();c.globalCompositeOperation="lighter";for(let i=0;i<N;i++){let r=d.r[i];const ac=.18/Math.max(.18,r);r-=pl*(.35+ac);d.a[i]+=dt*d.sp[i]*(.6+ac*2.2);if(r<.12){r=.85+sd(i+Math.floor(T*7))*.5;d.a[i]=sd(i*5+T)*TAU;}d.r[i]=r;const rr=r*S*.5,x=cx+Math.cos(d.a[i])*rr,y=cy+Math.sin(d.a[i])*rr*.78,iv=1-Math.min(1,(r-.12)/.8);if(d.k[i]>0){c.fillStyle="rgba("+(180+iv*60)+",90,"+(160+iv*60)+",.8)";c.fillRect(x-2,y-2,4+iv*3,4+iv*3);}else{c.fillStyle="rgba("+(200+iv*55)+","+(60+iv*120)+",200,"+(.35+iv*.6)+")";c.beginPath();c.arc(x,y,1+iv*2.2,0,TAU);c.fill();}}c.restore();c.save();c.globalCompositeOperation="lighter";const lr=cr*1.7+Math.sin(T*3)*cr*.08,lg=c.createRadialGradient(cx,cy,cr,cx,cy,lr);lg.addColorStop(0,"rgba(255,120,230,0)");lg.addColorStop(.8,"rgba(255,140,240,.35)");lg.addColorStop(1,"rgba(255,255,255,0)");c.fillStyle=lg;c.beginPath();c.arc(cx,cy,lr,0,TAU);c.fill();c.restore();const cg=c.createRadialGradient(cx,cy,0,cx,cy,cr);cg.addColorStop(0,"#000");cg.addColorStop(.82,"#000");cg.addColorStop(1,"rgba(0,0,0,0)");c.fillStyle=cg;c.beginPath();c.arc(cx,cy,cr,0,TAU);c.fill();},hud(d){return"HORIZON · "+d.fps+"FPS";}};
  })();

  /* ===== FX6 ===== */
  const FX6=(function(){const N=600;return{init(d){d.x=new Float32Array(N);d.y=new Float32Array(N);d.vx=new Float32Array(N);d.vy=new Float32Array(N);d.c=new Float32Array(N);for(let i=0;i<N;i++){d.x[i]=Math.random();d.y[i]=Math.random();d.c[i]=Math.random();}},
    frame(d){const c=d.ctx,W=d.W,H=d.H,T=d.t;c.fillStyle="#030611";c.fillRect(0,0,W,H);const vg=c.createRadialGradient(W*.5,H*.55,0,W*.5,H*.55,Math.max(W,H)*.6);vg.addColorStop(0,"rgba(20,60,120,.18)");vg.addColorStop(1,"rgba(2,4,12,0)");c.fillStyle=vg;c.fillRect(0,0,W,H);const fl=.4+d.param*1.3,dn=.5+d.burst*.8,mx=d.mOn?d.mx/W:-9,my=d.mOn?d.my/H:-9;c.save();c.globalCompositeOperation="lighter";for(let i=0;i<N;i++){let x=d.x[i],y=d.y[i];const ag=Math.sin(x*6+T*.6)*1.6+Math.cos(y*5.2-T*.5)*1.6+Math.sin((x+y)*4+T*.3);d.vx[i]+=Math.cos(ag)*9e-4*fl;d.vy[i]+=Math.sin(ag)*9e-4*fl;if(d.mOn){const dx=mx-x,dy=my-y,dd=dx*dx+dy*dy;if(dd<.06){d.vx[i]+=-dy*.01;d.vy[i]+=dx*.01;d.vx[i]+=dx*.004;d.vy[i]+=dy*.004;}}d.vx[i]*=.94;d.vy[i]*=.94;x+=d.vx[i];y+=d.vy[i];if(x<0)x+=1;else if(x>1)x-=1;if(y<0)y+=1;else if(y>1)y-=1;d.x[i]=x;d.y[i]=y;const sp=Math.min(1,(Math.abs(d.vx[i])+Math.abs(d.vy[i]))*60),t=d.c[i]*.5+sp*.5,r=Math.round(60+t*195),g=Math.round(150+(1-t)*60),b=Math.round(220-t*40);c.fillStyle="rgba("+r+","+g+","+b+","+(.35+sp*.5)*dn+")";c.beginPath();c.arc(x*W,y*H,.8+sp*2.4,0,TAU);c.fill();}c.restore();},hud(d){return"PLANKTON"+(d.mOn?" · current":"")+" · "+d.fps+"FPS";}};
  })();

  /* ===== FX7 ===== */
  const FX7=(function(){const SP=70;return{init(d){d.rings=[{r:.92,s:-.15,t:48,q:0},{r:.74,s:.28,t:24,q:24},{r:.56,s:-.42,t:12,q:0},{r:.4,s:.6,t:36,q:36},{r:.24,s:-.9,t:6,q:6}];d.sx=new Float32Array(SP);d.sy=new Float32Array(SP);d.sl=new Float32Array(SP);d.sv=new Float32Array(SP);d.si=0;if(!d._castBound){d._castBound=e=>{const r=d.canvas.getBoundingClientRect();this.trigger(d,(e.clientX-r.left)*DPR,(e.clientY-r.top)*DPR);};d.canvas.addEventListener('click',d._castBound);}},
    trigger(d,x,y){d.tx=x;d.ty=y;},
    frame(d,dt){const c=d.ctx,W=d.W,H=d.H,cx=(d.tx!=null?d.tx:W/2),cy=(d.ty!=null?d.ty:H/2),T=d.t,R=Math.min(W,H)*.45;if(d.bg===false){c.clearRect(0,0,W,H);}else{c.fillStyle="#0a0703";c.fillRect(0,0,W,H);}c.save();c.globalCompositeOperation="lighter";for(let i=0;i<14;i++){const a=T*.1+i*(TAU/14),lg=c.createLinearGradient(cx,cy,cx+Math.cos(a)*R*1.6,cy+Math.sin(a)*R*1.6);lg.addColorStop(0,"rgba(255,200,90,.1)");lg.addColorStop(1,"rgba(255,170,60,0)");c.strokeStyle=lg;c.lineWidth=10;c.beginPath();c.moveTo(cx,cy);c.lineTo(cx+Math.cos(a)*R*1.6,cy+Math.sin(a)*R*1.6);c.stroke();}c.restore();const spd=.4+d.param*1.4+d.burst*1.4;c.save();c.globalCompositeOperation="lighter";for(let ri=0;ri<d.rings.length;ri++){const rg=d.rings[ri];let ang=T*rg.s*spd;if(rg.q>0){const st=TAU/rg.q;ang=Math.round(ang/st)*st;}const rd=rg.r*R;c.strokeStyle="rgba(255,190,80,.5)";c.lineWidth=1.5;c.shadowColor="#ffb13c";c.shadowBlur=10;c.beginPath();c.arc(cx,cy,rd,0,TAU);c.stroke();c.shadowBlur=0;for(let k=0;k<rg.t;k++){const a=ang+k*(TAU/rg.t),x1=cx+Math.cos(a)*rd,y1=cy+Math.sin(a)*rd,x2=cx+Math.cos(a)*(rd+(k%2?9:5)),y2=cy+Math.sin(a)*(rd+(k%2?9:5));c.strokeStyle="rgba(255,210,120,.8)";c.lineWidth=2;c.beginPath();c.moveTo(x1,y1);c.lineTo(x2,y2);c.stroke();if(k%4===0){c.fillStyle="rgba(255,170,60,.9)";c.beginPath();c.arc(x1,y1,2.4,0,TAU);c.fill();}}c.strokeStyle="rgba(255,150,50,.35)";c.lineWidth=1;const pn=ri%2?7:5;c.beginPath();for(let k=0;k<=pn;k++){const a=ang*1.3+k*(TAU/pn),x=cx+Math.cos(a)*rd*.93,y=cy+Math.sin(a)*rd*.93;k===0?c.moveTo(x,y):c.lineTo(x,y);}c.closePath();c.stroke();}let em=Math.floor(1+spd);while(em-->0){const j=d.si;d.si=(d.si+1)%SP;if(d.sl[j]<=0){const a=Math.random()*TAU;d.sx[j]=cx+Math.cos(a)*R*.92;d.sy[j]=cy+Math.sin(a)*R*.92;d.sl[j]=1;d.sv[j]=-(20+Math.random()*40);}}for(let j=0;j<SP;j++){if(d.sl[j]>0){d.sy[j]+=d.sv[j]*dt;d.sx[j]+=Math.sin(T*3+j)*.4;d.sl[j]-=dt*.6;c.fillStyle="rgba(255,"+Math.round(160+d.sl[j]*60)+",60,"+Math.max(0,d.sl[j])*.9+")";c.beginPath();c.arc(d.sx[j],d.sy[j],1.6+d.sl[j]*1.6,0,TAU);c.fill();}}c.restore();},hud(d){return"CLOCKWORK · 5 rings · "+d.fps+"FPS";}};
  })();

  /* ===== FX8 TIME STOP SLASH — [v8] 느린축적→폭발 ===== */
  /* 3단계: 조심스런긁기(0~0.32) → 빠른증폭(0.32~0.52) → 화면폭발(0.52~0.72) → 소멸 */
  const FX8=(function(){
    const NL=600, NM=90;
    return{init(d){
      d.tsS=[];
      for(let i=0;i<NL;i++){
        // cls3=극장검(screen-fill) 80 / cls2=장검 100 / cls1=중검 160 / cls0=세검 260
        let cls,lenF,oxSpread,oySpread,phaseStart;
        if(i<80){
          cls=3;lenF=.85+sd(i*1.1)*.14;
          oxSpread=2.8;oySpread=2.2;phaseStart=.38+sd(i*9.1)*.18; // climax only
        } else if(i<180){
          cls=2;lenF=.55+sd(i*1.1)*.28;
          oxSpread=2.0;oySpread=1.6;phaseStart=.22+sd(i*9.1)*.22;
        } else if(i<340){
          cls=1;lenF=.22+sd(i*1.7)*.28;
          oxSpread=1.2;oySpread=1.0;phaseStart=.10+sd(i*9.1)*.28;
        } else {
          cls=0;lenF=.05+sd(i*2.3)*.14;
          oxSpread=.5;oySpread=.4;phaseStart=sd(i*9.1)*.35; // start early, tiny
        }
        d.tsS.push({
          cls, lenF,
          ang:-0.55+(sd(i*3.1)-.5)*(cls>=2?2.8:cls===1?1.8:1.0),
          ox:(sd(i*4.7)-.5)*oxSpread, oy:(sd(i*5.9)-.5)*oySpread,
          bend:(sd(i*7.3)-.5)*(cls>=2?.35:.18),
          phaseStart, seed:i
        });
      }
      d.tsM=[];for(let i=0;i<NM;i++)d.tsM.push({x:sd(i*1.3),y:sd(i*2.7),s:sd(i*3.9),ph:sd(i*5.1)*TAU});
      d.tsFlash=0;
      if(!d._castBound){d._castBound=e=>{const r=d.canvas.getBoundingClientRect();this.trigger(d,(e.clientX-r.left)*DPR,(e.clientY-r.top)*DPR);};d.canvas.addEventListener('click',d._castBound);}
    },
    trigger(d,x,y){d.tx=x;d.ty=y;},
    frame(d,dt){
      const c=d.ctx,W=d.W,H=d.H,cx=(d.tx!=null?d.tx:W/2),cy=(d.ty!=null?d.ty:H/2),T=d.t,S=Math.min(W,H);
      const per=4.2, ph=(T%per)/per;
      // stage gates
      const stg1End=.32, stg2End=.52, stg3End=.72;
      const inStg1=ph<stg1End, inStg2=ph>=stg1End&&ph<stg2End;
      const inStg3=ph>=stg2End&&ph<stg3End, inFade=ph>=stg3End;
      // BG
      if(d.bg===false){c.clearRect(0,0,W,H);}else{c.fillStyle="#030108";c.fillRect(0,0,W,H);}
      const desat=inStg3?.12+Math.sin(ph*Math.PI)*.08:inStg2?.06:0;
      if(desat>0){c.save();c.fillStyle="rgba(100,110,160,"+desat+")";c.fillRect(0,0,W,H);c.restore();}
      // crystal motes
      c.save();c.globalCompositeOperation="lighter";
      for(let i=0;i<NM;i++){const m=d.tsM[i];
        const x=((m.x+T*.00012*(m.s*.3))%1)*W, y=((m.y-T*.00008)%1+1)%1*H;
        const tw=.04+.05*Math.sin(T*.6+m.ph), sz=S*(.0012+m.s*.0028);
        c.fillStyle="hsla("+(220+m.s*80)+",60%,78%,"+tw+")";
        c.beginPath();c.arc(x,y,Math.max(.5,sz),0,TAU);c.fill();}
      c.restore();
      // flash
      if(d.burst>.6) d.tsFlash=1;
      if(inStg3&&ph<stg2End+.04&&d.tsFlash<.05) d.tsFlash=1;
      if(d.tsFlash>0) d.tsFlash=Math.max(0,d.tsFlash-dt*1.5);
      // stage progress values
      const prg1=inStg1?(ph/stg1End):1;
      const prg2=inStg2?((ph-stg1End)/(stg2End-stg1End)):inStg1?0:1;
      const prg3=inStg3?((ph-stg2End)/(stg3End-stg2End)):inStg1||inStg2?0:1;
      const fadeOut=inFade?Math.max(0,1-(ph-stg3End)/(1-stg3End)):1;
      // slash render
      c.save();c.globalCompositeOperation="lighter";
      for(let i=0;i<NL;i++){
        const sl=d.tsS[i];
        // per-slash phase gating
        let slAp=0;
        if(sl.cls===0){
          // tiny scratches: appear in stg1 proportional to prg1
          slAp=Math.max(0,Math.min(1,(prg1-sl.phaseStart/.35)/.12));
        } else if(sl.cls===1){
          // medium: appear in stg2
          const localP=prg2*.8+(prg3>.0?.2:0);
          slAp=Math.max(0,Math.min(1,(localP-sl.phaseStart/.35)/.15));
        } else if(sl.cls===2){
          // long: appear in stg2→stg3
          const localP=prg2*.4+prg3*.6;
          slAp=Math.max(0,Math.min(1,(localP-sl.phaseStart*.5)/.18));
        } else {
          // screen-fill: only in stg3 EXPLOSION
          slAp=Math.max(0,Math.min(1,(prg3-sl.phaseStart*.6)/.22));
        }
        if(slAp<=0) continue;
        const aGlobal=slAp*fadeOut;
        if(aGlobal<0.01) continue;
        const fl=d.tsFlash*(inStg3?.9:.4);
        // stg3: flat coverage, no camera zoom
        const len=S*sl.lenF;
        const ang=sl.ang;
        const mx=cx+sl.ox*S*.30, my=cy+sl.oy*S*.26;
        const dx=Math.cos(ang), dy=Math.sin(ang);
        const x1=mx-dx*len*.5, y1=my-dy*len*.5;
        const x2=mx+dx*len*.5, y2=my+dy*len*.5;
        const bx=mx+(-dy)*len*sl.bend, by=my+(dx)*len*sl.bend;
        const lw=sl.cls===3?S*.008:sl.cls===2?S*.006:sl.cls===1?S*.003:S*.0015;
        const coreA=aGlobal*(sl.cls===3?.98:sl.cls===2?.92:sl.cls===1?.72:.45)+fl*.5;
        // glow
        c.strokeStyle="rgba(150,90,255,"+(coreA*.55)+")";
        c.lineWidth=lw*2.6;c.lineCap="round";
        c.beginPath();c.moveTo(x1,y1);c.quadraticCurveTo(bx,by,x2,y2);c.stroke();
        // core
        c.strokeStyle="rgba("+(215+fl*40)+","+(230+fl*25)+",255,"+Math.min(1,coreA*1.15)+")";
        c.lineWidth=lw;
        c.beginPath();c.moveTo(x1,y1);c.quadraticCurveTo(bx,by,x2,y2);c.stroke();
        // stg3 cinematic afterimage
        if(sl.cls>=2&&inStg3){
          c.strokeStyle="rgba(200,150,255,"+(coreA*.28)+")";
          c.lineWidth=lw*3.5;
          c.beginPath();c.moveTo(x1-dx*S*.06*prg3,y1-dy*S*.06*prg3);
          c.quadraticCurveTo(bx,by,x2-dx*S*.06*prg3,y2-dy*S*.06*prg3);c.stroke();
        }
      }
      c.restore();
      // stage3 screen-fill white flash bloom
      if(inStg3&&prg3<.18){
        const fp=(1-prg3/.18);
        c.save();c.fillStyle="rgba(230,220,255,"+(fp*.35)+")";c.fillRect(0,0,W,H);c.restore();
      }
      // flash rings
      if(d.tsFlash>0.02){
        c.save();c.globalCompositeOperation="lighter";
        const rp=1-d.tsFlash;
        for(let r=0;r<4;r++){
          const rad=S*(rp*.8+r*.07), a2=d.tsFlash*(1-r*.22)*.55;
          c.strokeStyle="rgba(200,160,255,"+a2+")";c.lineWidth=S*.005*(1-r*.2);
          c.beginPath();c.arc(cx,cy,rad,0,TAU);c.stroke();
        }
        const fg=c.createRadialGradient(cx,cy,0,cx,cy,S*.45*d.tsFlash);
        fg.addColorStop(0,"rgba(240,230,255,"+(d.tsFlash*.8)+")");
        fg.addColorStop(.4,"rgba(150,100,255,"+(d.tsFlash*.4)+")");
        fg.addColorStop(1,"rgba(0,0,0,0)");
        c.fillStyle=fg;c.fillRect(0,0,W,H);c.restore();
      }
    },hud(d){return"TIME-STOP · build→EXPLODE · "+d.fps+"FPS";}};
  })();

  /* ===== FX9 — [v6.1 #1] 이전버전 롤백 ===== */
  const FX9=(function(){function il(c,cx,cy,R,T,se,of,col,lw,a){c.strokeStyle=col;c.lineWidth=lw;c.globalAlpha=a;c.beginPath();const N=72;for(let i=0;i<=N;i++){const ag=i/N*TAU,w=R*(1+.22*Math.sin(ag*3+T*1.3+se)+.13*Math.sin(ag*7-T*.9+se*2)+.07*Math.sin(ag*13+T*2.1)),x=cx+of+Math.cos(ag)*w,y=cy+Math.sin(ag)*w*.9;i===0?c.moveTo(x,y):c.lineTo(x,y);}c.closePath();c.stroke();c.globalAlpha=1;}
    return{init(d){d.v=[];for(let i=0;i<5;i++)d.v.push({sp:.3+Math.random()*.6,ph:Math.random()*TAU,r:18+Math.random()*30});},
    frame(d){const c=d.ctx,W=d.W,H=d.H,cx=W/2,cy=H/2,T=d.t;c.fillStyle="#f4ede2";c.fillRect(0,0,W,H);const ds=.4+d.param*1.6+d.burst*1.6;c.save();c.globalCompositeOperation="multiply";const co=["#ff5e9c","#3ee8ff","#7c3aed"];for(let i=0;i<3;i++){const a=T*.2+i*2.1,bx=cx+Math.cos(a)*W*.22,by=cy+Math.sin(a*.8)*H*.22,br=Math.min(W,H)*(.2+.05*Math.sin(T+i)),g=c.createRadialGradient(bx,by,0,bx,by,br);g.addColorStop(0,co[i]+"22");g.addColorStop(.6,co[i]+"10");g.addColorStop(1,co[i]+"00");c.fillStyle=g;c.beginPath();c.arc(bx,by,br,0,TAU);c.fill();}c.restore();c.strokeStyle="rgba(22,16,25,.1)";c.lineWidth=1;c.beginPath();for(let x=-H;x<W;x+=24){const ox=Math.sin(T*.6+x*.01)*8*ds;c.moveTo(x+ox,0);c.lineTo(x+ox+H,H);}c.stroke();for(let i=0;i<d.v.length;i++){const v=d.v[i],vx=(.5+.36*Math.sin(T*v.sp+v.ph))*W,vy=(.5+.3*Math.cos(T*v.sp*.8+v.ph*1.6))*H,rr=v.r*(1+.25*Math.sin(T*1.5+i))*(.7+.5*ds),g=c.createRadialGradient(vx,vy,0,vx,vy,rr);g.addColorStop(0,"#0a060c");g.addColorStop(.7,"#120a16");g.addColorStop(1,"rgba(244,237,226,0)");c.fillStyle=g;c.beginPath();c.arc(vx,vy,rr,0,TAU);c.fill();c.strokeStyle="rgba(15,8,18,.5)";c.lineWidth=2;c.beginPath();c.arc(vx,vy,rr*.72,0,TAU);c.stroke();}const R=Math.min(W,H)*.28;il(c,cx,cy,R,T,0,4*ds,"rgba(62,232,255,.35)",2,.5);il(c,cx,cy,R,T,0,-4*ds,"rgba(255,94,156,.35)",2,.5);il(c,cx,cy,R,T,0,0,"rgba(22,16,25,.85)",3,.9);il(c,cx,cy,R*.66,T,2.3,0,"rgba(22,16,25,.55)",2,.7);il(c,cx,cy,R*1.28,T,4.1,0,"rgba(22,16,25,.3)",1.5,.5);},hud(d){return"VOID "+d.v.length+" · "+d.fps+"FPS";}};
  })();

  /* ===== FX10 DATA CORE COLLAPSE — [v6.1 #2] 코어 폭발→데이터 분출 ===== */
  /* d.fx 충돌 제거(d.dc*). 중앙 코어가 터지며 그 지점에서 데이터가 방사 분출 */
  const FX10=(function(){const NC=26,NF=160;
    const ERRS=["SEGFAULT","NULL_REF","CORE_DUMP","STACK_OVF","KERNEL_PANIC","HEAP_CORRUPT","0xDEADBEEF"];
    return{init(d){
      d.dcCb=[];for(let i=0;i<NC;i++)d.dcCb.push({a:sd(i*1.1)*TAU,e:sd(i*2.3)*TAU,dist:.12+sd(i*3.7)*.5,sz:.02+sd(i*5.1)*.04,sp:.4+sd(i*7.3)*1,bit:sd(i*9.1)<.5?0:1,rot:sd(i*11)*TAU});
      // 데이터 파편 풀 (코어 중심에서만 스폰)
      d.dcX=new Float32Array(NF);d.dcY=new Float32Array(NF);d.dcVX=new Float32Array(NF);d.dcVY=new Float32Array(NF);
      d.dcL=new Float32Array(NF);d.dcCh=new Uint8Array(NF);
      d.dcExpT=2.6+Math.random()*2;d.dcExp=0;d.dcCore=1;d.dcShk=0;
      if(!d._castBound){d._castBound=e=>{const r=d.canvas.getBoundingClientRect();this.trigger(d,(e.clientX-r.left)*DPR,(e.clientY-r.top)*DPR);};d.canvas.addEventListener('click',d._castBound);}
    },
    trigger(d,x,y){d.tx=x;d.ty=y;},
    frame(d,dt){
      const c=d.ctx,W=d.W,H=d.H,cx=(d.tx!=null?d.tx:W/2),cy=(d.ty!=null?d.ty:H/2),T=d.t,S=Math.min(W,H);
      const col=(Math.sin(T*.8)+1)/2*.4+.35+d.burst*.4;
      d.dcExpT-=dt;
      // 코어 폭발 트리거
      if(d.dcExpT<=0||d.burst>.7){
        d.dcExpT=3+Math.random()*3;d.dcExp=1.0;d.dcShk=1.0;d.dcCore=0; // 코어 붕괴
        // 데이터 = 정확히 코어 중심에서 사방으로 분출
        for(let q=0;q<NF;q++){const ang=Math.random()*TAU,sp=S*(.02+Math.random()*.09);
          d.dcX[q]=cx;d.dcY[q]=cy;d.dcVX[q]=Math.cos(ang)*sp;d.dcVY[q]=Math.sin(ang)*sp;
          d.dcL[q]=.7+Math.random()*.5;d.dcCh[q]=(Math.random()<.5?48+Math.random()*2:33+Math.random()*94)|0;}
      }
      if(d.dcExp>0)d.dcExp=Math.max(0,d.dcExp-dt*1.0);
      if(d.dcShk>0)d.dcShk=Math.max(0,d.dcShk-dt*2.4);
      if(d.dcCore<1)d.dcCore=Math.min(1,d.dcCore+dt*.6); // 코어 재형성
      const shX=d.dcShk>0?(Math.random()-.5)*S*.03*d.dcShk:0,shY=d.dcShk>0?(Math.random()-.5)*S*.03*d.dcShk:0;
      if(d.bg===false){c.clearRect(0,0,W,H);}else{c.fillStyle="#020205";c.fillRect(0,0,W,H);}
      c.save();c.translate(shX,shY);
      // 폭발 순간 코어 지점 백색 충격 섬광
      if(d.dcExp>.55){const fl=(d.dcExp-.55)/.45;c.save();c.globalCompositeOperation="lighter";
        const fg=c.createRadialGradient(cx,cy,0,cx,cy,S*.55*fl);
        fg.addColorStop(0,"rgba(255,255,255,"+(fl*.9)+")");fg.addColorStop(.25,"rgba(120,240,255,"+(fl*.5)+")");fg.addColorStop(1,"rgba(0,0,0,0)");
        c.fillStyle=fg;c.fillRect(0,0,W,H);c.restore();}
      // 폭발 충격 링 (코어에서 퍼짐)
      if(d.dcExp>.05){c.save();c.globalCompositeOperation="lighter";
        for(let r=0;r<3;r++){const rp=(1-d.dcExp),rad=S*(rp*.55+r*.05);
          c.strokeStyle="rgba(60,232,255,"+(d.dcExp*(1-r*.3)*.5)+")";c.lineWidth=S*.004*(1-r*.25);
          c.beginPath();c.arc(cx,cy,rad,0,TAU);c.stroke();}c.restore();}
      // 중앙 코어 (폭발 시 사라졌다 재형성)
      c.save();c.globalCompositeOperation="lighter";
      const coreR=S*.10*d.dcCore*(1+Math.sin(T*3)*.06);
      if(coreR>1){
        // 와이어프레임 코어
        for(let ri=0;ri<4;ri++){const rr=coreR*(.4+ri*.22);c.strokeStyle="rgba(120,240,255,"+(.5*d.dcCore-ri*.08)+")";c.lineWidth=1.4;
          c.beginPath();for(let k=0;k<=30;k++){const a=k/30*TAU+T*(ri%2?-.7:.7);const x=cx+Math.cos(a)*rr,y=cy+Math.sin(a)*rr*(.5+ri*.14);k===0?c.moveTo(x,y):c.lineTo(x,y);}c.stroke();}
        const cg=c.createRadialGradient(cx,cy,0,cx,cy,coreR*1.3);cg.addColorStop(0,"rgba(180,250,255,"+(.6*d.dcCore)+")");cg.addColorStop(1,"rgba(0,0,0,0)");c.fillStyle=cg;c.beginPath();c.arc(cx,cy,coreR*1.3,0,TAU);c.fill();
      }
      c.restore();
      // 궤도 바이너리 큐브
      for(let i=0;i<NC;i++){const cb=d.dcCb[i];const dist=cb.dist*S*(.5+col)*(1+d.dcExp*.6),x=cx+Math.cos(cb.a+T*cb.sp*.3)*dist,y=cy+Math.sin(cb.e+T*cb.sp*.25)*dist*.7,sz=cb.sz*S*(1+col*.4),rr=cb.rot+T*cb.sp;c.save();c.translate(x,y);c.rotate(rr);c.strokeStyle="rgba(60,232,255,.6)";c.lineWidth=1;c.strokeRect(-sz/2,-sz/2,sz,sz);c.fillStyle="rgba(180,255,255,.7)";c.font=(sz*.8|0)+"px monospace";c.textAlign="center";c.textBaseline="middle";c.fillText((Math.sin(T*4+i)>0?cb.bit:1-cb.bit)?"1":"0",0,0);c.restore();}
      // 데이터 파편 — 코어 중심에서 분출된 ASCII (방사 비행)
      c.save();c.globalCompositeOperation="lighter";c.font=(S*.024|0)+"px monospace";c.textAlign="center";c.textBaseline="middle";
      for(let i=0;i<NF;i++){if(d.dcL[i]>0){
        d.dcX[i]+=d.dcVX[i];d.dcY[i]+=d.dcVY[i];d.dcVX[i]*=.985;d.dcVY[i]*=.985;d.dcVY[i]+=S*.0005;d.dcL[i]-=dt*.42;
        const al=Math.max(0,Math.min(1,d.dcL[i]));
        c.fillStyle=i%3===0?"rgba(255,70,150,"+al+")":i%3===1?"rgba(60,232,255,"+al+")":"rgba(210,255,255,"+al+")";
        c.fillText(String.fromCharCode(d.dcCh[i]),d.dcX[i],d.dcY[i]);
      }}
      c.restore();
      // 스캔라인 글리치
      c.fillStyle="rgba(255,255,255,"+(.03+col*.06+d.dcExp*.12)+")";for(let i=0;i<5;i++){const yy=sd(i*3+Math.floor(T*6))*H;c.fillRect(0,yy,W,2+d.dcExp*7);}
      c.restore();
    },hud(d){return"DATACORE · "+(d.dcExp>.3?"!! CORE BREACH !!":"stable")+" · "+d.fps+"FPS";}};
  })();

  /* ===== FX11 FERROFLUID — [v6.1 #3] 롤백 ===== */
  const FX11=(function(){const NS=11,ND=18;return{init(d){
    d.spk=new Float32Array(NS);d.spkV=new Float32Array(NS);for(let i=0;i<NS;i++)d.spk[i]=.3;
    d.dx=new Float32Array(ND);d.dy=new Float32Array(ND);d.dvx=new Float32Array(ND);d.dvy=new Float32Array(ND);d.dr=new Float32Array(ND);d.da=new Float32Array(ND);for(let i=0;i<ND;i++){d.da[i]=-1;}d.di=0;d.shed=0;if(!d._castBound){d._castBound=e=>{const r=d.canvas.getBoundingClientRect();this.trigger(d,(e.clientX-r.left)*DPR,(e.clientY-r.top)*DPR);};d.canvas.addEventListener('click',d._castBound);}},
  trigger(d,x,y){d.tx=x;d.ty=y;},
  frame(d,dt){const c=d.ctx,W=d.W,H=d.H,cx=(d.tx!=null?d.tx:W/2),cy=(d.ty!=null?d.ty:H/2),T=d.t,S=Math.min(W,H);
    if(d.bg===false){c.clearRect(0,0,W,H);}else{c.fillStyle="#040405";c.fillRect(0,0,W,H);}
    const field=.35+d.param*1.2+d.burst*1.3,base=S*.15;
    const mgx=d.mOn?d.mx:cx+Math.cos(T*.5)*base*.4,mgy=d.mOn?d.my:cy+Math.sin(T*.7)*base*.4;
    const lean=Math.atan2(mgy-cy,mgx-cx),ld=Math.min(1,Math.hypot(mgx-cx,mgy-cy)/(S*.4));
    /* magnetic ripple rings */
    c.save();c.globalCompositeOperation="lighter";for(let r=0;r<5;r++){const rr=base*(1.4+r*.5)+Math.sin(T*2-r)*S*.02;c.strokeStyle="rgba(120,140,170,"+(.12-r*.02)+")";c.lineWidth=1;c.beginPath();c.arc(cx,cy,rr,0,TAU);c.stroke();}c.restore();
    /* ferrofluid body — Rosensweig peaks leaning toward magnet */
    const M=160;c.beginPath();for(let i=0;i<=M;i++){const a=i/M*TAU;let sp=base*(1+field*(.45*Math.abs(Math.sin(a*6+T*1.3))+.32*Math.abs(Math.sin(a*11-T*.9))+.22*Math.pow(Math.abs(Math.sin(a*3+T*.6)),3)));const towards=Math.cos(a-lean);sp*=1+towards*ld*field*.55;const x=cx+Math.cos(a)*sp,y=cy+Math.sin(a)*sp;i===0?c.moveTo(x,y):c.lineTo(x,y);}c.closePath();
    const g=c.createRadialGradient(cx-base*.3,cy-base*.3,0,cx,cy,base*2.2);g.addColorStop(0,"#1c1c26");g.addColorStop(.5,"#0c0c10");g.addColorStop(1,"#040405");c.fillStyle=g;c.fill();
    /* iridescent oil-slick rim (clipped) */
    c.save();c.clip();for(let i=0;i<70;i++){const a=i/70*TAU;let sp=base*(1.05+field*.4);sp*=1+Math.cos(a-lean)*ld*field*.5;const x=cx+Math.cos(a)*sp,y=cy+Math.sin(a)*sp;c.fillStyle=hsl(a*57+T*40,85,60,.45);c.beginPath();c.arc(x,y,base*.2,0,TAU);c.fill();}c.restore();
    /* sharp spike outline + silver highlight */
    c.lineWidth=2;c.strokeStyle="rgba(210,220,235,.55)";c.beginPath();for(let i=0;i<=M;i++){const a=i/M*TAU;let sp=base*(1+field*(.45*Math.abs(Math.sin(a*6+T*1.3))+.32*Math.abs(Math.sin(a*11-T*.9))+.22*Math.pow(Math.abs(Math.sin(a*3+T*.6)),3)));sp*=1+Math.cos(a-lean)*ld*field*.55;const x=cx+Math.cos(a)*sp,y=cy+Math.sin(a)*sp;i===0?c.moveTo(x,y):c.lineTo(x,y);}c.closePath();c.stroke();
    /* shed droplets toward magnet on strong field */
    d.shed-=dt;if((field>1||ld>.5)&&d.shed<=0){const j=d.di;d.di=(d.di+1)%ND;const a=lean+(Math.random()-.5)*.8;d.dx[j]=cx+Math.cos(a)*base*1.1;d.dy[j]=cy+Math.sin(a)*base*1.1;const v=base*(2+field);d.dvx[j]=Math.cos(a)*v*.5;d.dvy[j]=Math.sin(a)*v*.5;d.dr[j]=base*(.06+Math.random()*.09);d.da[j]=1;d.shed=.12;}
    c.save();c.globalCompositeOperation="lighter";for(let i=0;i<ND;i++){if(d.da[i]<0)continue;const pull=field*S*1.2;const ax=(mgx-d.dx[i]),ay=(mgy-d.dy[i]),al=Math.hypot(ax,ay)+1;d.dvx[i]+=ax/al*pull*dt;d.dvy[i]+=ay/al*pull*dt;d.dvx[i]*=.96;d.dvy[i]*=.96;d.dx[i]+=d.dvx[i]*dt;d.dy[i]+=d.dvy[i]*dt;d.da[i]-=dt*.5;if(al<base*.5)d.da[i]-=dt*2;const dg=c.createRadialGradient(d.dx[i]-d.dr[i]*.3,d.dy[i]-d.dr[i]*.3,0,d.dx[i],d.dy[i],d.dr[i]);dg.addColorStop(0,"rgba(120,130,150,"+(d.da[i]*.9)+")");dg.addColorStop(1,"rgba(10,10,14,"+(d.da[i]*.5)+")");c.fillStyle=dg;c.beginPath();c.arc(d.dx[i],d.dy[i],d.dr[i],0,TAU);c.fill();}c.restore();
    /* specular dot */
    c.fillStyle="rgba(255,255,255,.7)";c.beginPath();c.arc(cx-base*.35,cy-base*.4,S*.012,0,TAU);c.fill();
  },hud(d){return"FERRO"+(d.mOn?" · magnet":"")+" · "+d.fps+"FPS";}};
})();

  const FX12=(function(){
    /* SOLAR FLARE RING v2 — 회화체 토러스 · 난류 림 · 프로미넌스 루프
       감산: 기하 링 7종 + 입자 400 제거 → 단일 호흡 토러스 + 테이퍼드 루프 */
    const PR=10, EJ=48, SH=3, SEG=40;
    const eo=x=>1-(1-x)*(1-x);
    function limb(a,t,s){ /* 난류 반경 변조 */
      return 1
        +.045*Math.sin(a*3+t*.7+s)
        +.028*Math.sin(a*7-t*1.13+s*2.7)
        +.016*Math.sin(a*13+t*1.9+s*5.1)
        +.009*Math.sin(a*23-t*2.6);
    }
    function ringPath(c,cx,cy,R,t,s,ph){
      c.beginPath();
      for(let i=0;i<=96;i++){const a=i/96*TAU;const r=R*limb(a+ph,t,s);
        const x=cx+Math.cos(a)*r,y=cy+Math.sin(a)*r*.94;
        i?c.lineTo(x,y):c.moveTo(x,y);}
      c.closePath();
    }
    /* 테이퍼드 프로미넌스 리본: 링 위 두 발 → 외곽 정점 루프 */
    function ribbon(c,cx,cy,R,a0,span,h,sway,col,wBase,alpha){
      const am=a0+span*.5;
      const fx0=cx+Math.cos(a0)*R, fy0=cy+Math.sin(a0)*R*.94;
      const fx1=cx+Math.cos(a0+span)*R, fy1=cy+Math.sin(a0+span)*R*.94;
      const tx=-Math.sin(am), ty=Math.cos(am);
      const ax=cx+Math.cos(am)*(R+h)+tx*sway, ay=cy+Math.sin(am)*(R+h)*.94+ty*sway;
      const N=22;
      const L=new Float32Array((N+1)*2), Rt=new Float32Array((N+1)*2);
      for(let i=0;i<=N;i++){const u=i/N,v=1-u;
        const px=v*v*fx0+2*v*u*ax+u*u*fx1, py=v*v*fy0+2*v*u*ay+u*u*fy1;
        const dx=2*(v*(ax-fx0)+u*(fx1-ax)), dy=2*(v*(ay-fy0)+u*(fy1-ay));
        const dl=Math.hypot(dx,dy)||1, nx=-dy/dl, ny=dx/dl;
        const w=wBase*(1-.74*Math.sin(Math.PI*u));
        L[i*2]=px+nx*w;L[i*2+1]=py+ny*w;Rt[i*2]=px-nx*w;Rt[i*2+1]=py-ny*w;
      }
      c.fillStyle=col;c.globalAlpha=clamp(alpha,0,1);
      c.beginPath();c.moveTo(L[0],L[1]);
      for(let i=1;i<=N;i++)c.lineTo(L[i*2],L[i*2+1]);
      for(let i=N;i>=0;i--)c.lineTo(Rt[i*2],Rt[i*2+1]);
      c.closePath();c.fill();c.globalAlpha=1;
    }
    return{
    init(d){
      d._pa0=new Float32Array(PR);d._psp=new Float32Array(PR);d._ph=new Float32Array(PR);
      d._pcy=new Float32Array(PR);d._pv=new Float32Array(PR);d._ps=new Float32Array(PR);
      d._pp=new Float32Array(PR);
      for(let i=0;i<PR;i++){d._pa0[i]=sd(i*1.31)*TAU;d._psp[i]=.16+sd(i*2.17)*.22;
        d._ph[i]=.4+sd(i*3.7)*.85;d._pcy[i]=sd(i*4.13);d._pp[i]=d._pcy[i];
        d._pv[i]=.09+sd(i*5.9)*.07;d._ps[i]=sd(i*7.7)*9;}
      d._ex=new Float32Array(EJ);d._ey=new Float32Array(EJ);d._evx=new Float32Array(EJ);
      d._evy=new Float32Array(EJ);d._el=new Float32Array(EJ);d._ei=0;
      d._sr=new Float32Array(SH);d._sl=new Float32Array(SH);d._si=0;
      d._bu=0;d._buPrev=0;
      if(!d._castBound){d._castBound=e=>{const r=d.canvas.getBoundingClientRect();this.trigger(d,(e.clientX-r.left)*DPR,(e.clientY-r.top)*DPR);};d.canvas.addEventListener('click',d._castBound);}
    },
    trigger(d,x,y){d.tx=x;d.ty=y;},
    _eject(d,x,y,n,S){for(let k=0;k<n;k++){const i=d._ei;d._ei=(d._ei+1)%EJ;
      const a=rand(0,TAU),sp=S*rand(.06,.22);
      d._ex[i]=x;d._ey[i]=y;d._evx[i]=Math.cos(a)*sp;d._evy[i]=Math.sin(a)*sp-S*.05;
      d._el[i]=rand(.5,1);}},
    frame(d,dt){
      const c=d.ctx,W=d.W,H=d.H,cx=(d.tx!=null?d.tx:W/2),cy=(d.ty!=null?d.ty:H/2),T=d.t,S=Math.min(W,H);
      const R=S*.21;
      if(d.burst>.5&&d._buPrev<=.5){
        d._bu=1;
        const i=d._si;d._si=(d._si+1)%SH;d._sr[i]=R*1.05;d._sl[i]=1;
        for(let k=0;k<3;k++){const a=rand(0,TAU);
          this._eject(d,cx+Math.cos(a)*R,cy+Math.sin(a)*R*.94,5,S);}
      }
      d._buPrev=d.burst;
      if(d._bu>0)d._bu=Math.max(0,d._bu-dt*.75);
      const bu=d._bu, heat=.5+d.param*1.05+bu*1.1;
      /* bg — 무광 심홍 비네트 · 중심은 공허(환공 일식) */
      if(d.bg===false){c.clearRect(0,0,W,H);}else{
      const bg=c.createRadialGradient(cx,cy,R*.2,cx,cy,Math.max(W,H)*.75);
      bg.addColorStop(0,"#050201");bg.addColorStop(.32,"#160803");
      bg.addColorStop(.6,"#0a0402");bg.addColorStop(1,"#030101");
      c.fillStyle=bg;c.fillRect(0,0,W,H);}
      c.save();c.globalCompositeOperation="lighter";
      /* 코로나 헤이즈 — 호흡 */
      const br=1+Math.sin(T*.9)*.05+bu*.22;
      const hg=c.createRadialGradient(cx,cy,R*.72,cx,cy,R*3.1*br);
      hg.addColorStop(0,"rgba(255,150,40,"+Math.min(1,.14+heat*.1)+")");
      hg.addColorStop(.4,"rgba(210,70,12,"+Math.min(1,.07+heat*.05)+")");
      hg.addColorStop(1,"rgba(0,0,0,0)");
      c.fillStyle=hg;c.beginPath();c.arc(cx,cy,R*3.1*br,0,TAU);c.fill();
      /* ── 토러스: 다층 회화 밴드 ── */
      const p1=Math.sin(T*1.2)*.02;
      c.lineJoin="round";
      c.strokeStyle="rgba(150,34,6,"+Math.min(1,.34*heat)+")"; c.lineWidth=R*.40; ringPath(c,cx,cy,R*(1+p1),T,1.3,0); c.stroke();
      c.strokeStyle="rgba(235,92,14,"+Math.min(1,.40*heat)+")"; c.lineWidth=R*.24; ringPath(c,cx,cy,R,T*1.06,4.7,2.1); c.stroke();
      c.strokeStyle="rgba(255,168,42,"+Math.min(1,.46*heat)+")"; c.lineWidth=R*.12; ringPath(c,cx,cy,R*(1-p1*.6),T*1.13,8.9,4.4); c.stroke();
      c.strokeStyle="rgba(255,232,150,"+Math.min(1,.34*heat+bu*.3)+")"; c.lineWidth=R*.045; ringPath(c,cx,cy,R,T*1.21,12.3,1.2); c.stroke();
      /* 표면 난류 과립 광반 */
      for(let i=0;i<SEG;i++){
        const a=i/SEG*TAU+T*.06+sd(i*1.7)*.4;
        const tb=.5+.5*Math.sin(a*5-T*1.7+sd(i)*9)*Math.sin(a*11+T*1.05+sd(i*2.3)*7);
        if(tb<.5)continue;
        const rr=R*limb(a,T*1.1,6.1)*(0.94+(sd(i*3.3)-.5)*.18);
        const px=cx+Math.cos(a)*rr,py=cy+Math.sin(a)*rr*.94;
        const tt=(tb-.5)*2;
        c.fillStyle="rgba(255,"+(205+(tt*50|0))+","+(130+(tt*90|0))+","+Math.min(1,tt*.7*heat)+")";
        c.beginPath();c.arc(px,py,1+tt*2.6,0,TAU);c.fill();
      }
      /* ── 프로미넌스 루프: 성장 → 체공 흔들림 → 분리·낙하 ── */
      for(let i=0;i<PR;i++){
        const prev=d._pcy[i];
        d._pcy[i]=(d._pcy[i]+dt*d._psp[i]*(1+bu*.4))%1;
        const cyc=d._pcy[i];
        const gro=cyc<.32?eo(cyc/.32):1;
        const det=cyc>.74?(cyc-.74)/.26:0;
        const al=(1-det)*gro;
        const a0=d._pa0[i],span=d._pv[i]*TAU,am=a0+span*.5;
        if(prev<.74&&cyc>=.74&&prev<=cyc){
          const hN=R*d._ph[i]*heat;
          this._eject(d,cx+Math.cos(am)*(R+hN),cy+Math.sin(am)*(R+hN)*.94,3,S);
        }
        if(al<.03)continue;
        const h=R*d._ph[i]*heat*gro*(1+bu*.5)*(1+det*.35);
        const sway=Math.sin(T*1.6+d._ps[i])*R*.16*gro;
        ribbon(c,cx,cy,R,a0,span,h,sway,"rgb(205,58,10)",R*.085,al*.28);
        ribbon(c,cx,cy,R,a0,span,h*.94,sway*.96,"rgb(255,150,40)",R*.05,al*.4);
        ribbon(c,cx,cy,R,a0,span,h*.86,sway*.9,"rgb(255,236,170)",R*.02,al*.5);
        const fxp=cx+Math.cos(am)*R,fyp=cy+Math.sin(am)*R*.94;
        const fg=c.createRadialGradient(fxp,fyp,0,fxp,fyp,Math.max(1,R*.3*gro));
        fg.addColorStop(0,"rgba(255,210,110,"+Math.min(1,al*.35)+")");fg.addColorStop(1,"rgba(255,120,20,0)");
        c.fillStyle=fg;c.beginPath();c.arc(fxp,fyp,Math.max(1,R*.3*gro),0,TAU);c.fill();
      }
      /* 분출 낙하물 — 고리 중력 회귀 */
      for(let i=0;i<EJ;i++){if(d._el[i]<=0)continue;
        const dx=d._ex[i]-cx,dy=(d._ey[i]-cy)/.94;
        const rr=Math.hypot(dx,dy)||1;
        const pull=(rr-R)*1.4;
        d._evx[i]-=dx/rr*pull*dt;d._evy[i]-=dy/rr*pull*dt*.94;
        d._evx[i]*=Math.pow(.6,dt);d._evy[i]*=Math.pow(.6,dt);
        d._ex[i]+=d._evx[i]*dt;d._ey[i]+=d._evy[i]*dt;
        d._el[i]-=dt*.8;const L=Math.max(0,d._el[i]);
        c.fillStyle="rgba(255,"+(140+(L*100|0))+","+(40+(L*80|0))+","+(L*.8)+")";
        c.beginPath();c.arc(d._ex[i],d._ey[i],1+L*2.4,0,TAU);c.fill();}
      /* 굴절 충격파면 */
      for(let i=0;i<SH;i++){if(d._sl[i]<=0)continue;
        d._sr[i]+=S*dt*.6;d._sl[i]-=dt*.85;const L=Math.max(0,d._sl[i]);
        const r0=d._sr[i];
        const sg=c.createRadialGradient(cx,cy,Math.max(1,r0*.82),cx,cy,Math.max(2,r0*1.04));
        sg.addColorStop(0,"rgba(0,0,0,0)");sg.addColorStop(.78,"rgba(255,140,40,"+(L*.16)+")");
        sg.addColorStop(.95,"rgba(255,240,190,"+(L*.4)+")");sg.addColorStop(1,"rgba(0,0,0,0)");
        c.fillStyle=sg;c.beginPath();c.arc(cx,cy,Math.max(2,r0*1.04),0,TAU);c.fill();}
      /* 버스트 플래시 */
      if(bu>.25){
        const bf=c.createRadialGradient(cx,cy,R*.6,cx,cy,R*4);
        bf.addColorStop(0,"rgba(255,240,190,"+(bu*.34)+")");
        bf.addColorStop(.4,"rgba(255,140,30,"+(bu*.16)+")");
        bf.addColorStop(1,"rgba(0,0,0,0)");
        c.fillStyle=bf;c.fillRect(0,0,W,H);}
      c.restore();
      /* 중심 공허 재확정 — 가산 누출 차단 */
      const hole=c.createRadialGradient(cx,cy,0,cx,cy,R*.62);
      hole.addColorStop(0,"rgba(4,1,1,.9)");hole.addColorStop(.75,"rgba(6,2,1,.45)");hole.addColorStop(1,"rgba(6,2,1,0)");
      c.fillStyle=hole;c.beginPath();c.arc(cx,cy,R*.62,0,TAU);c.fill();
    },hud(d){return"SOLAR · torus+prominence · "+d.fps+"FPS";}};
  })();

  /* ===== FX13 GLOW SPORE ===== */
  const FX13=(function(){const N=520;return{init(d){d.x=new Float32Array(N);d.y=new Float32Array(N);d.vx=new Float32Array(N);d.vy=new Float32Array(N);d.c=new Float32Array(N);d.z=new Float32Array(N);d.gl=new Float32Array(N);for(let i=0;i<N;i++){d.x[i]=Math.random();d.y[i]=Math.random();d.c[i]=Math.random();d.z[i]=Math.random();d.vx[i]=(Math.random()-.5)*6e-4;d.vy[i]=(Math.random()-.5)*6e-4;}d.pmx=-9;d.pmy=-9;},
  frame(d,dt){const c=d.ctx,W=d.W,H=d.H,T=d.t;const bg=c.createRadialGradient(W*.5,H*.5,0,W*.5,H*.5,Math.max(W,H)*.7);bg.addColorStop(0,"#04141e");bg.addColorStop(1,"#01060a");c.fillStyle=bg;c.fillRect(0,0,W,H);
    const dn=.5+d.param*.8,ps=(Math.sin(T*1.5)+1)/2*.4+.6;const mx=d.mOn?d.mx/W:-9,my=d.mOn?d.my/H:-9;
    const msp=d.mOn?Math.hypot(mx-d.pmx,my-d.pmy):0;d.pmx=mx;d.pmy=my;const stir=d.mOn?Math.min(1,msp*40):0;
    if(d.burst>.5){for(let i=0;i<N;i++)d.gl[i]=Math.min(1,d.gl[i]+.8);d.burst=0;}
    c.save();c.globalCompositeOperation="lighter";
    for(let i=0;i<N;i++){const fa=Math.sin(d.x[i]*5+T*.3)*1.4+Math.cos(d.y[i]*4-T*.25)*1.4;d.vx[i]+=Math.cos(fa)*2.6e-4;d.vy[i]+=Math.sin(fa)*2.6e-4-8e-5;
      if(d.mOn){const dx=mx-d.x[i],dy=my-d.y[i],dd=dx*dx+dy*dy;if(dd<.05){const inv=(.05-dd)/.05;d.vx[i]-=dx*.02*inv;d.vy[i]-=dy*.02*inv;d.gl[i]=Math.min(1,d.gl[i]+inv*stir*1.5+inv*.02);}}
      d.vx[i]*=.95;d.vy[i]*=.95;d.x[i]+=d.vx[i];d.y[i]+=d.vy[i];if(d.x[i]<0)d.x[i]+=1;else if(d.x[i]>1)d.x[i]-=1;if(d.y[i]<0)d.y[i]+=1;else if(d.y[i]>1)d.y[i]-=1;
      d.gl[i]*=Math.pow(.97,dt*60);
      const t=d.c[i],z=d.z[i],g=d.gl[i];const rad=(.8+z*3.2)*(1+ps*.3)*(1+g*1.4),al=clamp((.18+(1-z)*.45)*dn+g*.7,0,1);
      const r=Math.round(40+t*60+g*180),gg=Math.round(190-t*90+g*40),b=255;c.fillStyle="rgba("+r+","+gg+","+b+","+al+")";c.beginPath();c.arc(d.x[i]*W,d.y[i]*H,rad,0,TAU);c.fill();
      if(g>.4){c.fillStyle="rgba(200,255,255,"+(g*.5)+")";c.beginPath();c.arc(d.x[i]*W,d.y[i]*H,rad*.4,0,TAU);c.fill();}}
    /* disturbance filaments near cursor */
    if(d.mOn&&stir>.05){c.lineWidth=1;for(let i=0;i<N;i+=3){if(d.gl[i]<.25)continue;const j=(i+11)%N;const dx=d.x[i]-d.x[j],dy=d.y[i]-d.y[j],dd=dx*dx+dy*dy;if(dd<.01){c.strokeStyle="rgba(120,240,255,"+((1-dd/.01)*.3*d.gl[i])+")";c.beginPath();c.moveTo(d.x[i]*W,d.y[i]*H);c.lineTo(d.x[j]*W,d.y[j]*H);c.stroke();}}}
    c.restore();
  },hud(d){return"SPORE"+(d.mOn?" · disturb":"")+" · "+d.fps+"FPS";}};
})();

  const FX14=(function(){return{init(d){d.dod=[];const ph=(1+Math.sqrt(5))/2;const vs=[];function P(x,y,z){vs.push([x,y,z]);}for(let s1=-1;s1<=1;s1+=2)for(let s2=-1;s2<=1;s2+=2)for(let s3=-1;s3<=1;s3+=2)P(s1,s2,s3);for(let s1=-1;s1<=1;s1+=2)for(let s2=-1;s2<=1;s2+=2){P(0,s1/ph,s2*ph);P(s1/ph,s2*ph,0);P(s1*ph,0,s2/ph);}d.dv=vs;d.de=[];for(let a=0;a<vs.length;a++)for(let b=a+1;b<vs.length;b++){let dx=vs[a][0]-vs[b][0],dy=vs[a][1]-vs[b][1],dz=vs[a][2]-vs[b][2];const dd=dx*dx+dy*dy+dz*dz;if(dd>.2&&dd<.6)d.de.push([a,b]);}if(!d._castBound){d._castBound=e=>{const r=d.canvas.getBoundingClientRect();this.trigger(d,(e.clientX-r.left)*DPR,(e.clientY-r.top)*DPR);};d.canvas.addEventListener('click',d._castBound);}},
    trigger(d,x,y){d.tx=x;d.ty=y;},
    frame(d){const c=d.ctx,W=d.W,H=d.H,cx=(d.tx!=null?d.tx:W/2),cy=(d.ty!=null?d.ty:H/2),T=d.t,S=Math.min(W,H);if(d.bg===false){c.clearRect(0,0,W,H);}else{c.fillStyle="#070500";c.fillRect(0,0,W,H);}const spd=.3+d.param*1+d.burst*1,R=S*.36;c.save();c.globalCompositeOperation="lighter";
      // flower of life
      c.strokeStyle="rgba(255,190,70,.22)";c.lineWidth=1;const rr=R*.34;c.beginPath();c.arc(cx,cy,rr,0,TAU);c.stroke();for(let ring=1;ring<=2;ring++)for(let k=0;k<6*ring;k++){const a=k/(6*ring)*TAU+T*.05*spd,x=cx+Math.cos(a)*rr*ring,y=cy+Math.sin(a)*rr*ring;c.beginPath();c.arc(x,y,rr,0,TAU);c.stroke();}
      // rotating dodecahedron wireframe
      const ax=T*.3*spd,ay=T*.21*spd;c.strokeStyle="rgba(255,210,110,.7)";c.lineWidth=1.4;c.shadowColor="#ffb13c";c.shadowBlur=8;const pts=[];for(let i=0;i<d.dv.length;i++){let v=[d.dv[i][0],d.dv[i][1],d.dv[i][2]];const c1=Math.cos(ax),s1=Math.sin(ax),c2=Math.cos(ay),s2=Math.sin(ay);let x=v[0]*c1-v[2]*s1,z=v[0]*s1+v[2]*c1,y=v[1]*c2-z*s2;z=v[1]*s2+z*c2;const k=4/(5-z);pts.push([cx+x*k*R*.5,cy+y*k*R*.5]);}c.beginPath();for(let e=0;e<d.de.length;e++){const a=d.de[e][0],b=d.de[e][1];c.moveTo(pts[a][0],pts[a][1]);c.lineTo(pts[b][0],pts[b][1]);}c.stroke();c.shadowBlur=0;
      // floating rune glyphs
      const rn=8;for(let i=0;i<rn;i++){const a=-T*.4*spd+i*(TAU/rn),x=cx+Math.cos(a)*R*.78,y=cy+Math.sin(a)*R*.78;c.save();c.translate(x,y);c.rotate(a+T*.5);c.strokeStyle="rgba(255,180,60,.8)";c.lineWidth=1.6;c.beginPath();const gs=S*.018;c.moveTo(-gs,-gs);c.lineTo(gs,-gs);c.lineTo(0,gs);c.closePath();c.moveTo(0,-gs);c.lineTo(0,gs*.4);c.stroke();c.restore();}
      // particle dust
      for(let i=0;i<70;i++){const a=sd(i)*TAU+T*.2,rd=R*(.2+sd(i*1.7)*.9),x=cx+Math.cos(a)*rd,y=cy+Math.sin(a)*rd;c.fillStyle="rgba(255,200,90,"+(.2+.3*Math.sin(T*3+i))+")";c.fillRect(x,y,1.6,1.6);}c.restore();
    },hud(d){return"SACRED · "+d.fps+"FPS";}};
  })();

  /* ===== FX15 ABSOLUTE ZERO FROST — [v6.1 #6] 롤백 ===== */
  const FX15=(function(){
    const TAU2=6.28318530718;
    return{init(d){
      d.iceFrags=new Float32Array(80*3);
      for(let i=0;i<80;i++){d.iceFrags[i*3]=sd(i*1.1);d.iceFrags[i*3+1]=sd(i*2.3);d.iceFrags[i*3+2]=sd(i*3.7)*TAU2;}
      d.cracks=[];
      for(let i=0;i<28;i++){
        const a=i*(TAU2/28)+(sd(i)-.5)*.3,len=.32+sd(i*2)*.35;
        const br=[];for(let b=0;b<3;b++)br.push({t:.28+sd(i*3+b)*.55,a:a+(sd(i*4+b)-.5)*.9,len:len*(sd(i*5+b)*.38+.18)});
        d.cracks.push({a,len,br});
      }
      if(!d._castBound){d._castBound=e=>{const r=d.canvas.getBoundingClientRect();this.trigger(d,(e.clientX-r.left)*DPR,(e.clientY-r.top)*DPR);};d.canvas.addEventListener('click',d._castBound);}
    },
    trigger(d,x,y){d.tx=x;d.ty=y;},
    frame(d,dt){
      const c=d.ctx,W=d.W,H=d.H,cx=(d.tx!=null?d.tx:W/2),cy=(d.ty!=null?d.ty:H/2),T=d.t,S=Math.min(W,H);
      const gspd=.35+d.param*.85+d.burst*.55,per=6;
      const phase=(T*gspd%per)/per,growth=Math.min(1,phase/0.40),fade=phase>0.60?(1-(phase-0.60)/0.40):1;
      const armLen=S*.34*(.6+d.param*.4);
      // BG
      if(d.bg===false){c.clearRect(0,0,W,H);}else{
      const bg=c.createRadialGradient(cx,cy,0,cx,cy,S);
      bg.addColorStop(0,"#091825");bg.addColorStop(.5,"#04090f");bg.addColorStop(1,"#020408");
      c.fillStyle=bg;c.fillRect(0,0,W,H);}
      // Ground ice cracks
      c.save();c.globalCompositeOperation="lighter";
      const crP=Math.min(1,growth*1.6);
      for(const cr of d.cracks){
        const cl=cr.len*S*.5*crP,x2=cx+Math.cos(cr.a)*cl,y2=cy+Math.sin(cr.a)*cl*.28;
        c.strokeStyle="rgba(90,170,255,"+(fade*.18)+")";c.lineWidth=.9;
        c.beginPath();c.moveTo(cx,cy);c.lineTo(x2,y2);c.stroke();
        for(const br of cr.br){
          if(crP<br.t)continue;
          const bp=(crP-br.t)/(1-br.t);
          const bx1=cx+Math.cos(cr.a)*cr.len*S*.5*br.t,by1=cy+Math.sin(cr.a)*cr.len*S*.5*.28*br.t;
          const bl2=br.len*S*.28*bp;
          c.strokeStyle="rgba(70,145,255,"+(fade*.11)+")";c.lineWidth=.5;
          c.beginPath();c.moveTo(bx1,by1);c.lineTo(bx1+Math.cos(br.a)*bl2,by1+Math.sin(br.a)*bl2*.22);c.stroke();
        }
      }
      c.restore();
      // Floor glow
      if(growth>.08){
        c.save();c.globalCompositeOperation="lighter";
        const ig=c.createRadialGradient(cx,cy+S*.1,0,cx,cy+S*.1,S*.55);
        ig.addColorStop(0,"rgba(50,150,255,"+(growth*.07*fade)+")");ig.addColorStop(.5,"rgba(25,70,180,"+(growth*.035*fade)+")");ig.addColorStop(1,"rgba(0,0,0,0)");
        c.fillStyle=ig;c.fillRect(0,0,W,H);c.restore();
      }
      // 6-arm crystal
      c.save();c.globalCompositeOperation="lighter";
      for(let arm=0;arm<6;arm++){
        const armA=arm*(TAU2/6)+T*.006;
        const ag=Math.min(1,growth*1.9-arm*.04);if(ag<=0)continue;
        const elen=armLen*ag;
        const segs=22;let px=cx,py=cy;
        for(let k=0;k<segs;k++){
          const t=(k+1)/segs;if(t>ag*segs/segs)break;
          const nx=cx+Math.cos(armA)*elen*(k+1)/segs;
          const ny=cy+Math.sin(armA)*elen*(k+1)/segs;
          const lum=188+k*3.2;
          c.strokeStyle="rgba("+(lum-22)+","+lum+",255,"+(fade*.82)+")";
          c.lineWidth=2.6-k*.09;c.lineCap="round";
          c.beginPath();c.moveTo(px,py);c.lineTo(nx,ny);c.stroke();
          c.strokeStyle="rgba(215,238,255,"+(fade*.45)+")";c.lineWidth=.55;
          c.beginPath();c.moveTo(px,py);c.lineTo(nx,ny);c.stroke();
          // secondary branches at every 3rd segment
          if(k>0&&k%3===0){
            const bL=elen*.32*(1-k/segs)*.9;
            for(const bs of [-1,1]){
              const bA=armA+bs*Math.PI/3;
              const bP=Math.min(1,(ag*segs-k-0.4)/2.8);if(bP<=0)continue;
              const bEx=px+Math.cos(bA)*bL*bP,bEy=py+Math.sin(bA)*bL*bP;
              c.strokeStyle="rgba(148,205,255,"+(fade*.68)+")";c.lineWidth=1.2;
              c.beginPath();c.moveTo(px,py);c.lineTo(bEx,bEy);c.stroke();
              // tertiary
              if(bP>.55){
                const t3p=(bP-.55)/.45,t3L=bL*.38*t3p;
                const mBx=px+Math.cos(bA)*bL*bP*.48,mBy=py+Math.sin(bA)*bL*bP*.48;
                for(const t3s of [-1,1]){
                  const t3a=bA+t3s*Math.PI/3;
                  c.strokeStyle="rgba(110,178,255,"+(fade*.42)+")";c.lineWidth=.7;
                  c.beginPath();c.moveTo(mBx,mBy);c.lineTo(mBx+Math.cos(t3a)*t3L,mBy+Math.sin(t3a)*t3L);c.stroke();
                  // quaternary tip spikes
                  if(t3p>.6){
                    const q4=bL*.14*(t3p-.6)/.4;
                    const q4x=mBx+Math.cos(t3a)*t3L,q4y=mBy+Math.sin(t3a)*t3L;
                    for(const q4s of [-1,1]){
                      c.strokeStyle="rgba(88,160,255,"+(fade*.28)+")";c.lineWidth=.4;
                      c.beginPath();c.moveTo(q4x,q4y);c.lineTo(q4x+Math.cos(t3a+q4s*Math.PI/3)*q4,q4y+Math.sin(t3a+q4s*Math.PI/3)*q4);c.stroke();
                    }
                  }
                }
              }
            }
          }
          px=nx;py=ny;
        }
        // Active freeze-front glow
        if(ag<.96&&ag>.03){
          const fgx=cx+Math.cos(armA)*elen,fgy=cy+Math.sin(armA)*elen;
          const fg=c.createRadialGradient(fgx,fgy,0,fgx,fgy,S*.065);
          fg.addColorStop(0,"rgba(195,232,255,.55)");fg.addColorStop(.4,"rgba(90,175,255,.22)");fg.addColorStop(1,"rgba(0,0,0,0)");
          c.fillStyle=fg;c.fillRect(0,0,W,H);
        }
      }
      // Center core
      const cR=S*.032*(1+Math.sin(T*3)*.18)*Math.min(1,growth*3.5);
      const cg=c.createRadialGradient(cx,cy,0,cx,cy,cR*2.8);
      cg.addColorStop(0,"rgba(255,255,255,.95)");cg.addColorStop(.22,"rgba(200,232,255,.75)");
      cg.addColorStop(.58,"rgba(70,155,255,.32)");cg.addColorStop(1,"rgba(0,0,0,0)");
      c.fillStyle=cg;c.fillRect(0,0,W,H);
      c.restore();
      // Floating ice micro-crystals
      c.save();c.globalCompositeOperation="lighter";
      for(let i=0;i<80;i++){
        const ix=((d.iceFrags[i*3]+T*.004)%1),iy=((d.iceFrags[i*3+1]-T*.007+2)%1);
        const sz=(S*.006+sd(i*4.9)*S*.008)*growth,pulse=.45+Math.sin(T*2+d.iceFrags[i*3+2])*.55;
        if(sz<1)continue;
        c.strokeStyle="rgba(145,205,255,"+(0.12*pulse*fade)+")";c.lineWidth=.55;
        c.save();c.translate(ix*W,iy*H);c.rotate(d.iceFrags[i*3+2]+T*.15);
        c.beginPath();for(let k=0;k<6;k++){const a=k*(TAU2/6);c.moveTo(0,0);c.lineTo(Math.cos(a)*sz,Math.sin(a)*sz);}
        c.stroke();c.restore();
      }
      c.restore();
      // Cold mist
      c.save();c.globalCompositeOperation="screen";
      for(let i=0;i<9;i++){
        const mx=cx+(sd(i)-.5)*W*.85,myy=H-((T*18+i*52)%(H*1.35)),mr=S*(.065+sd(i*2)*.075);
        const mg=c.createRadialGradient(mx,myy,0,mx,myy,mr);
        mg.addColorStop(0,"rgba(175,218,255,.09)");mg.addColorStop(1,"rgba(175,218,255,0)");
        c.fillStyle=mg;c.beginPath();c.arc(mx,myy,mr,0,TAU2);c.fill();
      }
      c.restore();
      if(d.burst>.4){const bf=d.burst;c.save();c.fillStyle="rgba(195,228,255,"+(bf*.42)+")";c.fillRect(0,0,W,H);c.restore();}
    },hud(d){return"FROST · depth4 · "+d.fps+"FPS";}};
  })();

  /* ===== FX16 BLACK HOLE SINGULARITY — [Fix v6-F16] 미세개선(구조유지) ===== */
  /* 입자 600→900 + 포톤링 +20% + 호라이즌 shimmer + 도플러 대비 강화 */
  const FX16=(function(){const N=900;return{init(d){d.a=new Float32Array(N);d.r=new Float32Array(N);d.s=new Float32Array(N);d.c=new Float32Array(N);for(let i=0;i<N;i++){d.a[i]=sd(i)*TAU;d.r[i]=.3+sd(i*1.7)*.95;d.s[i]=.5+sd(i*2.9)*.8;d.c[i]=sd(i*3.3);}if(!d._castBound){d._castBound=e=>{const r=d.canvas.getBoundingClientRect();this.trigger(d,(e.clientX-r.left)*DPR,(e.clientY-r.top)*DPR);};d.canvas.addEventListener('click',d._castBound);}},
    trigger(d,x,y){d.tx=x;d.ty=y;},
    frame(d,dt){const c=d.ctx,W=d.W,H=d.H,cx=(d.tx!=null?d.tx:W/2),cy=(d.ty!=null?d.ty:H/2),T=d.t,S=Math.min(W,H);if(d.bg===false){c.clearRect(0,0,W,H);}else{c.fillStyle="#020104";c.fillRect(0,0,W,H);}
      // lensed starfield
      c.save();c.globalCompositeOperation="lighter";for(let i=0;i<60;i++){const sa=sd(i)*TAU,sr=S*(.5+sd(i*1.3)*.6),bend=S*.05/Math.max(.2,sr/S),x=cx+Math.cos(sa)*sr,y=cy+Math.sin(sa+bend)*sr;c.fillStyle="rgba(200,200,255,"+(.2+sd(i*2)*.4)+")";c.fillRect(x,y,1.4,1.4);}c.restore();
      const spd=.5+d.param*1.1+d.burst*1.4,disk=S*.34;c.save();c.globalCompositeOperation="lighter";
      // accretion disk (Keplerian + tilt + 강화 도플러)
      for(let i=0;i<N;i++){const kep=spd*(.4+.6/Math.max(.25,d.r[i]));d.a[i]+=dt*d.s[i]*kep;const rr=d.r[i]*disk,x=cx+Math.cos(d.a[i])*rr,y=cy+Math.sin(d.a[i])*rr*.34;
        // 도플러: 접근측 청백 / 후퇴측 적색 (대비 강화)
        const dop=.5+.5*Math.cos(d.a[i]),hot=1-Math.min(1,(d.r[i]-.3)/.95);
        let R2,G2,B2;
        if(dop>.5){const t2=(dop-.5)*2;R2=180+t2*60;G2=210+t2*45;B2=230+t2*25;}
        else{const t2=(.5-dop)*2;R2=255;G2=140-t2*90;B2=50-t2*45;}
        c.fillStyle="rgba("+(R2|0)+","+(G2|0)+","+(B2|0)+","+(.35+dop*.55*(.5+hot*.5))+")";
        c.beginPath();c.arc(x,y,.7+hot*2.1,0,TAU);c.fill();}c.restore();
      // photon ring (+20% glow)
      c.save();c.globalCompositeOperation="lighter";const pr=S*.135;
      const pg=c.createRadialGradient(cx,cy,pr*.8,cx,cy,pr*1.28);pg.addColorStop(0,"rgba(255,210,150,0)");pg.addColorStop(.6,"rgba(255,205,150,.6)");pg.addColorStop(1,"rgba(255,170,90,0)");c.fillStyle=pg;c.beginPath();c.arc(cx,cy,pr*1.28,0,TAU);c.fill();c.restore();
      // event horizon + shimmer (sin파 엣지 진동)
      c.save();c.globalCompositeOperation="lighter";
      c.strokeStyle="rgba(255,200,140,.25)";c.lineWidth=1.5;c.beginPath();
      for(let k=0;k<=60;k++){const a=k/60*TAU;const sh=1+.03*Math.sin(a*9+T*4)+.02*Math.sin(a*15-T*3);const x=cx+Math.cos(a)*S*.132*sh,y=cy+Math.sin(a)*S*.132*sh;k===0?c.moveTo(x,y):c.lineTo(x,y);}
      c.closePath();c.stroke();c.restore();
      const eg=c.createRadialGradient(cx,cy,0,cx,cy,S*.13);eg.addColorStop(0,"#000");eg.addColorStop(.85,"#000");eg.addColorStop(1,"rgba(0,0,0,0)");c.fillStyle=eg;c.beginPath();c.arc(cx,cy,S*.13,0,TAU);c.fill();
    },hud(d){return"SINGULARITY · "+d.fps+"FPS";}};
  })();

  /* ===== FX17 HEXAGON PULSE — [Fix v5-F17] 조명 교체 ===== */
  /* 볼류메트릭 콘 기둥 제거 → 파동 진원지 지면 방사 발광 + 셀 자체 발광 */
  const FX17=(function(){return{init(d){if(!d._castBound){d._castBound=e=>{const r=d.canvas.getBoundingClientRect();this.trigger(d,(e.clientX-r.left)*DPR,(e.clientY-r.top)*DPR);};d.canvas.addEventListener('click',d._castBound);}},
    trigger(d,x,y){d.tx=x;d.ty=y;},
    frame(d){const c=d.ctx,W=d.W,H=d.H,cx=(d.tx!=null?d.tx:W/2),T=d.t,S=Math.min(W,H);
      // [v6.1 #15] 깊이 그라디언트 배경 (평면감 → 공간감)
      if(d.bg===false){c.clearRect(0,0,W,H);}else{const bgg=c.createLinearGradient(0,H*.42,0,H);bgg.addColorStop(0,"#02060a");bgg.addColorStop(1,"#040d14");c.fillStyle=bgg;c.fillRect(0,0,W,H);}
      const amp=.4+d.param*1.1+d.burst*1.5,hr=S*.05,hw=hr*1.732,vh=hr*1.5,hy=H*.42;c.save();
      const cols=Math.ceil(W/hw)+2,rows=Math.ceil((H-hy)/vh)+2;
      for(let ry=0;ry<rows;ry++){for(let rx=0;rx<cols;rx++){const ox=rx*hw+(ry%2?hw/2:0)-hw,bx=ox,by=hy+ry*vh;const persp=(by-hy)/(H-hy);const dx=bx-cx,dy=by-(hy+(H-hy)*.5),dist=Math.sqrt(dx*dx+dy*dy)/S;
        // 2중 사인 합성 — 더 유기적인 물결
        const wph=dist*10-T*4, wph2=dist*6+T*2.3;
        const wave=(Math.sin(wph)*.7+Math.sin(wph2)*.3)*amp*(1-persp*.4);
        const lift=wave*S*.045;const bri=.5+.5*(Math.sin(wph)*.7+Math.sin(wph2)*.3);
        const yy=by-lift;
        c.beginPath();for(let k=0;k<6;k++){const a=k*(TAU/6)+Math.PI/6,x=bx+Math.cos(a)*hr*(.9),y=yy+Math.sin(a)*hr*(.9)*(.6+persp*.4);k===0?c.moveTo(x,y):c.lineTo(x,y);}c.closePath();
        // [v6.1 #15] 입체 셀 — 방사 그라디언트 (높이 = 밝기, 부피감)
        const selfGlow=Math.max(0,bri-.4)*1.8, base=16+persp*20;
        const cg=c.createRadialGradient(bx,yy-hr*.3,0,bx,yy,hr*1.2);
        const hi=base+selfGlow*70;
        cg.addColorStop(0,"rgb("+(hi*.6|0)+","+((hi+selfGlow*40)|0)+","+((hi+selfGlow*20)|0)+")");
        cg.addColorStop(1,"rgb("+(base*.5|0)+","+((base+4)|0)+","+((base+8)|0)+")");
        c.fillStyle=cg;c.fill();
        // 가장자리 — 파동 크레스트에서 강한 시안 하이라이트
        c.strokeStyle="rgba("+Math.round(40+bri*50)+","+Math.round(180+bri*75)+","+Math.round(220+bri*35)+","+(.18+bri*.75*(.4+persp*.6))+")";c.lineWidth=1+bri*2;c.stroke();
        // 크레스트 정점 — 강조 광점 (사인 물결의 마루 시각화)
        if(bri>.78){const gl=Math.pow((bri-.78)/.22,1.3);
          c.save();c.globalCompositeOperation="lighter";
          const pg=c.createRadialGradient(bx,yy,0,bx,yy,hr*.9*gl);
          pg.addColorStop(0,"rgba(120,245,255,"+(gl*.9)+")");pg.addColorStop(1,"rgba(60,232,255,0)");
          c.fillStyle=pg;c.beginPath();c.arc(bx,yy,hr*.9*gl,0,TAU);c.fill();c.restore();}
      }}c.restore();
      // [v6.1 #7] 파동 진원지 지면 방사 발광 + 중앙 펄스 링 전부 삭제 → 사인 물결만
    },hud(d){return"HEXGRID · sine-wave · "+d.fps+"FPS";}};
  })();

  /* ===== FX19 MANA TORNADO — [Fix v5-F19] 별 입자 분출 제거 ===== */
  const FX19=(function(){const NP=420;return{init(d){
    d.pu=new Float32Array(NP);d.pph=new Float32Array(NP);d.psp=new Float32Array(NP);d.pc=new Float32Array(NP);for(let i=0;i<NP;i++){d.pu[i]=Math.random();d.pph[i]=Math.random()*TAU;d.psp[i]=.6+Math.random()*.8;d.pc[i]=Math.random();}
    d.bolts=[];d.boltT=0;
    if(!d._castBound){d._castBound=e=>{const r=d.canvas.getBoundingClientRect();this.trigger(d,(e.clientX-r.left)*DPR,(e.clientY-r.top)*DPR);};d.canvas.addEventListener('click',d._castBound);}
  },
  trigger(d,x,y){d.tx=x;d.ty=y;},
  frame(d,dt){const c=d.ctx,W=d.W,H=d.H,cx=(d.tx!=null?d.tx:W/2),T=d.t,S=Math.min(W,H);if(d.bg===false){c.clearRect(0,0,W,H);}else{c.fillStyle="#03070a";c.fillRect(0,0,W,H);}
    const spin=.5+d.param*1.3+d.burst*1.4,topY=H*.16,botY=H*.92,hgt=botY-topY;
    const lean=d.mOn?clamp((d.mx-cx)/(W*.5),-1,1)*S*.06:0;
    const funR=u=>S*(.30*(1-u*.78))*(.55+.45*Math.abs(Math.sin(u*3+T*.3)));
    const funX=u=>cx+lean*Math.pow(u,1.5);
    c.save();c.globalCompositeOperation="lighter";
    /* swirling ribbons */
    const ribs=6;for(let rb=0;rb<ribs;rb++){const ph=rb*(TAU/ribs),teal=rb%2===0;c.beginPath();for(let s=0;s<=60;s++){const u=s/60,y=botY-u*hgt,rad=funR(u),ang=ph+u*7-T*spin*2,x=funX(u)+Math.cos(ang)*rad,yy=y+Math.sin(ang)*rad*.16;s===0?c.moveTo(x,yy):c.lineTo(x,yy);}c.strokeStyle=teal?"rgba(40,220,210,.5)":"rgba(255,150,210,.5)";c.lineWidth=S*.012;c.stroke();c.strokeStyle=teal?"rgba(180,255,250,.6)":"rgba(255,210,235,.6)";c.lineWidth=S*.003;c.stroke();}
    /* ascending mana particles */
    for(let i=0;i<NP;i++){d.pu[i]+=dt*d.psp[i]*(.12+spin*.06);if(d.pu[i]>1)d.pu[i]-=1;const u=d.pu[i],y=botY-u*hgt,rad=funR(u)*(.6+sd(i*1.7)*.6),ang=d.pph[i]+u*9-T*spin*2.4,x=funX(u)+Math.cos(ang)*rad,yy=y+Math.sin(ang)*rad*.16;const fade=Math.sin(u*Math.PI),t=d.pc[i];c.fillStyle="rgba("+Math.round(120+t*135)+","+Math.round(230-t*90)+","+Math.round(220+t*35)+","+(fade*.7)+")";const sz=(.8+(1-u)*1.6)*fade;c.beginPath();c.arc(x,yy,sz,0,TAU);c.fill();}
    /* glowing eye core at apex */
    const eg=c.createRadialGradient(funX(0)+0,topY,0,cx,topY,S*.12);eg.addColorStop(0,"rgba(200,255,250,"+(.5+d.burst*.4)+")");eg.addColorStop(.5,"rgba(90,210,220,.25)");eg.addColorStop(1,"rgba(0,0,0,0)");c.fillStyle=eg;c.beginPath();c.arc(funX(0),topY,S*.12,0,TAU);c.fill();
    /* lightning crackle inside funnel */
    d.boltT-=dt;if(d.boltT<=0||d.burst>.6){d.boltT=.18+Math.random()*.3;const u0=Math.random()*.7;const pts=[];let yy=botY-u0*hgt,xx=funX(u0)+(Math.random()-.5)*funR(u0);for(let k=0;k<6;k++){pts.push([xx,yy]);yy-=hgt*.12;xx+=(Math.random()-.5)*S*.06;}d.bolts.push({pts,life:1});if(d.bolts.length>6)d.bolts.shift();}
    for(let b=d.bolts.length-1;b>=0;b--){const bo=d.bolts[b];bo.life-=dt*4;if(bo.life<=0){d.bolts.splice(b,1);continue;}c.strokeStyle="rgba(190,255,250,"+(bo.life*.7)+")";c.lineWidth=1.4;c.shadowColor="#7ff";c.shadowBlur=8;c.beginPath();c.moveTo(bo.pts[0][0],bo.pts[0][1]);for(let k=1;k<bo.pts.length;k++)c.lineTo(bo.pts[k][0],bo.pts[k][1]);c.stroke();}c.shadowBlur=0;
    /* base suction disk + debris */
    for(let r=0;r<4;r++){const rr=S*(.06+r*.05);c.strokeStyle="rgba(120,220,230,"+(.2-r*.04)+")";c.lineWidth=2;c.beginPath();c.ellipse(cx,botY,rr,rr*.22,0,0,TAU);c.stroke();}
    for(let i=0;i<26;i++){const a=i/26*TAU-T*spin*1.5,rr=S*(.08+sd(i*2.3)*.12),x=cx+Math.cos(a)*rr,y=botY+Math.sin(a)*rr*.22;c.fillStyle="rgba(160,230,235,"+(.15+.2*Math.sin(T*4+i))+")";c.fillRect(x,y,1.6,1.6);}
    c.restore();
  },hud(d){return"TORNADO"+(d.mOn?" · lean":"")+" · "+d.fps+"FPS";}};
})();

  const FX20=(function(){const NR=10,NA=170;return{init(d){
    d.snR=[];for(let i=0;i<NR;i++)d.snR.push({l:0,hue:205,amp:0,beat:0});
    d.snI=0;d.snNext=.4;d._tick=0;d._lift=0;d._bp=0;
    d.ax=new Float32Array(NA);d.ay=new Float32Array(NA);d.ar=new Float32Array(NA);
    for(let i=0;i<NA;i++)d.ar[i]=sd(i*3.1);
    if(!d._castBound){d._castBound=e=>{const r=d.canvas.getBoundingClientRect();this.trigger(d,(e.clientX-r.left)*DPR,(e.clientY-r.top)*DPR);};d.canvas.addEventListener('click',d._castBound);}
  },
  trigger(d,x,y){d.tx=x;d.ty=y;},
  _emit(d,beat){const j=d.snI;d.snI=(d.snI+1)%NR;
    const r=d.snR[j];r.l=1;r.beat=beat?1:0;
    r.hue=beat?48:205+Math.random()*70;
    r.amp=(beat?1.3:.55)+Math.random()*.4;
    d._tick=1;},
  frame(d,dt){const c=d.ctx,W=d.W,H=d.H,cx=(d.tx!=null?d.tx:W/2),cy=(d.ty!=null?d.ty:H/2),T=d.t,S=Math.min(W,H);
    if(d.bg===false){c.clearRect(0,0,W,H);}else{
    const bg=c.createRadialGradient(cx,cy,0,cx,cy,Math.max(W,H)*.72);
    bg.addColorStop(0,"#0a0818");bg.addColorStop(.6,"#050410");bg.addColorStop(1,"#020208");
    c.fillStyle=bg;c.fillRect(0,0,W,H);}
    const inten=.5+d.param*.9;
    const mdx=d.mOn?clamp((d.mx-cx)/(S*.5),-1,1):0,mdy=d.mOn?clamp((d.my-cy)/(S*.5),-1,1):0;
    const mm=Math.hypot(mdx,mdy),mAng=Math.atan2(mdy,mdx);
    if(d.burst>.5&&d._bp<=.5){this._emit(d,true);d._lift=1;}
    d._bp=d.burst;
    d.snNext-=dt;if(d.snNext<=0){d.snNext=.9-d.param*.45+Math.random()*.3;this._emit(d,false);}
    if(d._tick>0)d._tick=Math.max(0,d._tick-dt*3.2);
    if(d._lift>0)d._lift=Math.max(0,d._lift-dt*1.4);
    c.save();c.globalCompositeOperation="lighter";
    /* ── 압력 파면: 압축 크레스트 + 희박 꼬리 ── */
    for(const r of d.snR){if(r.l<=0)continue;r.l-=dt*.42;
      const L=Math.max(0,r.l);if(L<=0)continue;
      const rad=S*.95*(1-Math.pow(L,2));
      if(rad<2)continue;
      const al=Math.pow(L,1.5)*inten;
      const bw=S*(.05+r.amp*.03);
      const pg=c.createRadialGradient(cx,cy,Math.max(1,rad-bw*2.2),cx,cy,rad+bw*.5);
      pg.addColorStop(0,"rgba(0,0,0,0)");
      pg.addColorStop(.55,hsl(r.hue,55,38,al*.10));
      pg.addColorStop(.88,hsl(r.hue,70,72,al*(r.beat?.5:.34)));
      pg.addColorStop(1,"rgba(0,0,0,0)");
      c.fillStyle=pg;c.beginPath();c.arc(cx,cy,rad+bw*.5,0,TAU);c.fill();
      /* 크레스트 — 도플러 파면 */
      c.strokeStyle=hsl(r.hue,r.beat?40:75,r.beat?88:74,al*.6);
      c.lineWidth=Math.max(.5,(1.6+r.amp*2.6)*L);
      c.beginPath();
      for(let k=0;k<=72;k++){const a=k/72*TAU;
        const dop=1-.16*mm*Math.cos(a-mAng);
        const wob=1+.022*Math.sin(a*3+T*1.6)*L;
        const rr=rad*wob*dop;
        const x=cx+Math.cos(a)*rr,y=cy+Math.sin(a)*rr*.96;
        k?c.lineTo(x,y):c.moveTo(x,y);}
      c.closePath();c.stroke();
      /* 내측 잔향 에코 */
      c.strokeStyle=hsl(r.hue+18,60,82,al*.18);
      c.lineWidth=Math.max(.4,L*1.1);
      c.beginPath();c.arc(cx,cy,rad*.9,0,TAU);c.stroke();}
    /* ── 진애장: 파면 통과 시 발광 변위 ── */
    for(let i=0;i<NA;i++){const ba=d.ar[i]*TAU+Math.sin(T*.13+i)*.012,bd=S*(.08+sd(i*5.7)*.88);
      let push=0;
      for(const r of d.snR){if(r.l<=0)continue;const L=r.l,rad=S*.95*(1-Math.pow(L,2));
        const diff=Math.abs(bd-rad),bw2=S*.055;
        if(diff<bw2)push+=(1-diff/bw2)*L*(r.beat?1.5:1);}
      if(push>1.4)push=1.4;
      const disp=push*S*.035;
      const x=cx+Math.cos(ba)*(bd+disp),y=cy+Math.sin(ba)*(bd+disp)*.96;
      const sh=.045+push*.42+d._lift*.12;
      c.fillStyle="rgba(175,215,255,"+Math.min(1,sh)+")";
      c.fillRect(x-.7,y-.7,1.4,1.4);
      if(push>.55){const g=c.createRadialGradient(x,y,0,x,y,3.5+push*3);
        g.addColorStop(0,"rgba(200,235,255,"+((push-.55)*.5)+")");g.addColorStop(1,"rgba(120,180,255,0)");
        c.fillStyle=g;c.beginPath();c.arc(x,y,3.5+push*3,0,TAU);c.fill();}}
    /* ── 코어: 정적 호흡 + 방출 틱 ── */
    const cw=.18+.82*d._tick;
    const cr=S*.07*(0.7+cw*.8);
    const cg=c.createRadialGradient(cx,cy,0,cx,cy,cr);
    cg.addColorStop(0,"rgba(190,225,255,"+Math.min(1,.22+cw*.5)+")");
    cg.addColorStop(.55,"rgba(90,140,220,"+(.1+cw*.18)+")");
    cg.addColorStop(1,"rgba(0,0,0,0)");
    c.fillStyle=cg;c.beginPath();c.arc(cx,cy,cr,0,TAU);c.fill();
    if(d._tick>0){c.strokeStyle="rgba(210,235,255,"+(d._tick*.4)+")";c.lineWidth=1;
      c.beginPath();c.arc(cx,cy,S*.05+(1-d._tick)*S*.06,0,TAU);c.stroke();}
    c.restore();
  },hud(d){return"SONIC · pressure front"+(d.mOn?" · doppler":"")+" · "+d.fps+"FPS";}};
})();

  const FX21=(function(){
    function bolt(x1,y1,x2,y2,dep,j,arr){if(dep<=0){arr.push([x2,y2]);return;}const mx=(x1+x2)/2+(Math.random()-.5)*j,my=(y1+y2)/2+(Math.random()-.5)*j;bolt(x1,y1,mx,my,dep-1,j*.62,arr);if(Math.random()<.32){const fx=mx+(Math.random()-.5)*j*1.5,fy=my+(Math.random()-.5)*j*1.5;arr.push([mx,my]);arr.push([fx,fy]);arr.push([mx,my]);}bolt(mx,my,x2,y2,dep-1,j*.62,arr);}
    return{init(d){d.vtTear=null;d.vtStars=null;d.vtArcs=[];d.vtW=0;d.vtPulse=0;
      if(!d._castBound){d._castBound=e=>{const r=d.canvas.getBoundingClientRect();this.trigger(d,(e.clientX-r.left)*DPR,(e.clientY-r.top)*DPR);};d.canvas.addEventListener('click',d._castBound);}
    },
    trigger(d,x,y){d.tx=x;d.ty=y;},
    frame(d,dt){
      const c=d.ctx,W=d.W,H=d.H,cx=(d.tx!=null?d.tx:W/2),cy=(d.ty!=null?d.ty:H/2),T=d.t,S=Math.min(W,H);
      const surge=d.burst;
      if(!d.vtTear||d.vtW!==W||d.vtCx!==cx){
        const steps=18,ht=H*.78,L=[],R=[];
        for(let i=0;i<=steps;i++){const t=i/steps,y=H*.11+t*ht,sp=Math.sin(t*Math.PI)*S*.085;
          L.push([cx-sp-(sd(i*1.3+W))*S*.03+5,y]);R.push([cx+sp+(sd(i*2.1+W))*S*.03-5,y]);}
        d.vtTear={L,R};
        d.vtStars=Array.from({length:220},(_,i)=>({x:sd(i*1.1+W),y:sd(i*2.3+W),r:sd(i*3.7+W)*.0035+.0008,b:sd(i*4.1)*TAU,dp:.3+sd(i*5.3)*.7}));
        d.vtW=W;d.vtCx=cx;
      }
      // 번개 생성 (주기 + surge 시 빈도↑)
      d.vtPulse-=dt;
      if(d.vtPulse<=0||surge>.4){
        d.vtPulse=surge>.4?.12:.4+Math.random()*.5;
        const sides=[...d.vtTear.L,...[...d.vtTear.R].reverse()];
        const cnt=surge>.4?4:2;
        for(let n=0;n<cnt;n++){
          const i=Math.floor(Math.random()*(sides.length-1));
          const [x1,y1]=sides[i];
          const ex=cx+(sd(x1+T)-.5)*S*.5, ey=y1+(sd(y1+T)-.5)*S*.35;
          const pts=[[x1,y1]];bolt(x1,y1,ex,ey,6,S*.12,pts);
          d.vtArcs.push({pts,life:1,age:0,max:6+Math.random()*12,hue:265+Math.random()*45});
        }
      }
      if(d.bg===false){c.clearRect(0,0,W,H);}else{c.fillStyle="#000007";c.fillRect(0,0,W,H);}
      // 보이드 내부 (clip)
      c.save();c.beginPath();
      d.vtTear.L.forEach(([x,y],i)=>i===0?c.moveTo(x,y):c.lineTo(x,y));
      [...d.vtTear.R].reverse().forEach(([x,y])=>c.lineTo(x,y));
      c.closePath();c.clip();
      // 깊은 코스믹 네뷸라
      for(const[nx,ny,nr,nc] of [[cx,H*.34,.30,"rgba(80,20,160,.55)"],[cx,H*.62,.24,"rgba(120,10,190,.45)"],[cx+W*.025,H*.22,.18,"rgba(40,5,120,.6)"],[cx-W*.04,H*.78,.20,"rgba(150,30,210,.4)"]]){
        const g=c.createRadialGradient(nx,ny,0,nx,ny,nr*S);g.addColorStop(0,nc);g.addColorStop(1,"rgba(0,0,0,0)");c.fillStyle=g;c.fillRect(0,0,W,H);
      }
      // 별 (시차 트윙클)
      for(const st of d.vtStars){st.b+=.015;const a=(.35+Math.sin(st.b)*.35)*st.dp*Math.min(1,T*.02);c.fillStyle="rgba(210,185,255,"+a+")";c.beginPath();c.arc(st.x*W,st.y*H,st.r*S,0,TAU);c.fill();}
      c.restore();
      // 균열 윤곽 — 강한 다중 bloom
      c.save();c.globalCompositeOperation="screen";
      const pulse=.6+Math.sin(T*2)*.4;
      for(const[bl,lw,al] of [[S*.06,S*.018,.22],[S*.026,S*.006,.55],[S*.009,S*.002,.95]]){
        c.shadowBlur=bl;c.shadowColor="rgba(185,70,255,.95)";c.strokeStyle="rgba(210,90,255,"+(al*pulse)+")";
        c.lineWidth=lw;c.lineCap="round";c.lineJoin="round";
        c.beginPath();d.vtTear.L.forEach(([x,y],i)=>i===0?c.moveTo(x,y):c.lineTo(x,y));
        [...d.vtTear.R].reverse().forEach(([x,y])=>c.lineTo(x,y));c.closePath();c.stroke();c.shadowBlur=0;
      }
      // 번개 arc
      /* [FIX] filter()→인플레이스 역방향 splice */
      for(let _i=d.vtArcs.length-1;_i>=0;_i--){if(d.vtArcs[_i].age>=d.vtArcs[_i].max)d.vtArcs.splice(_i,1);}
      for(const arc of d.vtArcs){
        arc.age++;const p=arc.age/arc.max,a=(1-p)*arc.life;
        for(const[w2,al2] of [[3.5,.3],[1.6,.7],[.7,1]]){
          c.strokeStyle="hsla("+arc.hue+",100%,"+(70+al2*15)+"%,"+(a*al2)+")";
          c.lineWidth=w2*(1-p*.4);c.lineCap="round";
          c.shadowBlur=10;c.shadowColor="hsl("+arc.hue+",100%,70%)";
          c.beginPath();arc.pts.forEach(([x,y],i)=>i===0?c.moveTo(x,y):c.lineTo(x,y));c.stroke();
        }
        c.shadowBlur=0;
      }
      c.restore();
      // surge 중앙 섬광
      if(surge>.3){const sf=(surge-.3)/.7;c.save();c.globalCompositeOperation="screen";const sg=c.createRadialGradient(cx,cy,0,cx,cy,S*.5);sg.addColorStop(0,"rgba(210,110,255,"+(sf*.3)+")");sg.addColorStop(1,"rgba(0,0,0,0)");c.fillStyle=sg;c.fillRect(0,0,W,H);c.restore();}
    },hud(d){return"VOIDTEAR · restored · "+d.fps+"FPS";}};
  })();

  /* ===== FX22 BLACK HOLE VORTEX — [Fix v6-F22] 원작급(★5) 재현·강화 ===== */
  /* 나선 강착원반 1200 + 중력렌즈 다중링 + 상대론 제트 + 도플러 비대칭 + 호라이즌 */
  const FX22=(function(){const N=1200;return{init(d){
      d.bhA=new Float32Array(N);d.bhR=new Float32Array(N);d.bhS=new Float32Array(N);d.bhK=new Float32Array(N);d.bhZ=new Float32Array(N);
      for(let i=0;i<N;i++){d.bhA[i]=sd(i)*TAU;d.bhR[i]=.30+sd(i*1.7)*1.0;d.bhS[i]=.5+sd(i*2.3)*.9;d.bhK[i]=sd(i*3.3);d.bhZ[i]=(sd(i*4.1)-.5);}
      d.bhSurge=0;
      if(!d._castBound){d._castBound=e=>{const r=d.canvas.getBoundingClientRect();this.trigger(d,(e.clientX-r.left)*DPR,(e.clientY-r.top)*DPR);};d.canvas.addEventListener('click',d._castBound);}
    },
    trigger(d,x,y){d.tx=x;d.ty=y;},
    frame(d,dt){
      const c=d.ctx,W=d.W,H=d.H,cx=(d.tx!=null?d.tx:W/2),cy=(d.ty!=null?d.ty:H/2),T=d.t,S=Math.min(W,H);
      d.bhSurge=Math.max(0,d.bhSurge+d.burst*.1-dt*.4);
      const EH=S*.085, disk=S*.40, surge=1+d.bhSurge*.6;
      // 잔상 누적 (모션 트레일감) — 완전 클리어 대신 반투명
      if(d.bg===false){c.globalCompositeOperation="destination-out";c.fillStyle="rgba(0,0,0,.30)";c.fillRect(0,0,W,H);c.globalCompositeOperation="source-over";}else{c.fillStyle="rgba(0,0,5,.30)";c.fillRect(0,0,W,H);}
      // 상대론적 제트 (수직 양방향)
      c.save();c.globalCompositeOperation="lighter";
      for(const dir of [-1,1]){
        const jg=c.createLinearGradient(cx,cy,cx,cy+dir*S*.55);
        jg.addColorStop(0,"rgba(150,200,255,"+(.25*surge)+")");
        jg.addColorStop(.4,"rgba(120,90,255,"+(.12*surge)+")");
        jg.addColorStop(1,"rgba(60,20,140,0)");
        c.fillStyle=jg;
        c.beginPath();c.moveTo(cx-S*.012,cy);c.lineTo(cx+S*.012,cy);
        c.lineTo(cx+S*.05,cy+dir*S*.55);c.lineTo(cx-S*.05,cy+dir*S*.55);c.closePath();c.fill();
        // 제트 코어
        c.strokeStyle="rgba(200,220,255,"+(.3*surge)+")";c.lineWidth=2;
        c.beginPath();c.moveTo(cx,cy);c.lineTo(cx+(Math.sin(T*3)*S*.01),cy+dir*S*.5);c.stroke();
      }
      c.restore();
      // 강착원반 글로 (배경 헤일로)
      c.save();c.globalCompositeOperation="lighter";
      for(const[dr,ba] of [[disk*1.35,.18],[disk,.30],[disk*.6,.44],[EH*1.6,.6]]){
        const ag=c.createRadialGradient(cx,cy,EH*.7,cx,cy,dr);
        ag.addColorStop(0,"rgba(255,165,55,"+(ba*.4*surge)+")");
        ag.addColorStop(.45,"rgba(120,60,200,"+(ba*.25)+")");
        ag.addColorStop(1,"rgba(0,0,0,0)");
        c.fillStyle=ag;c.beginPath();c.ellipse(cx,cy,dr,dr*.42,0,0,TAU);c.fill();
      }
      c.restore();
      // 강착원반 입자 — 케플러 나선 + 도플러 비대칭 + 기울기
      c.save();c.globalCompositeOperation="lighter";
      for(let i=0;i<N;i++){
        const ac=.18/Math.max(.18,d.bhR[i]);
        const kep=(.45+ac)*(.5+d.bhS[i]*.5);
        d.bhR[i]-=dt*.04*(.3+ac)*surge;
        d.bhA[i]+=dt*kep*1.6*surge;
        if(d.bhR[i]<.16){d.bhR[i]=.9+sd(i+Math.floor(T*5))*.4;d.bhA[i]=sd(i*5+T)*TAU;}
        const rr=d.bhR[i]*disk;
        // 기울어진 원반 (타원 + z 깊이)
        const x=cx+Math.cos(d.bhA[i])*rr;
        const y=cy+Math.sin(d.bhA[i])*rr*.40 + d.bhZ[i]*EH*.5;
        const iv=1-Math.min(1,(d.bhR[i]-.16)/.9);
        // 도플러: 접근측(왼쪽 진행) 청백 밝게 / 후퇴측 적색 어둡게
        const dop=.5+.5*Math.cos(d.bhA[i]);
        let R2,G2,B2,al;
        if(dop>.5){const t2=(dop-.5)*2;R2=200+t2*55;G2=210+t2*45;B2=200+t2*55;al=.5+iv*.5;}
        else{const t2=(.5-dop)*2;R2=255;G2=130-t2*70;B2=40;al=.3+iv*.4;}
        c.fillStyle="rgba("+(R2|0)+","+(G2|0)+","+(B2|0)+","+(al*(.6+dop*.5))+")";
        const sz=(d.bhK[i]>.85)?2+iv*2:1+iv*1.6;
        c.beginPath();c.arc(x,y,sz,0,TAU);c.fill();
      }
      c.restore();
      // [v6.1 #10] 어색한 호 3개(중력렌즈 아크) 삭제 — 대체안 없어 제거. 포톤링만 유지
      c.save();c.globalCompositeOperation="lighter";
      // 포톤 링
      const pg=c.createRadialGradient(cx,cy,EH*1.0,cx,cy,EH*1.35);
      pg.addColorStop(0,"rgba(255,220,170,0)");pg.addColorStop(.55,"rgba(255,210,150,"+(.7*surge)+")");pg.addColorStop(1,"rgba(255,170,90,0)");
      c.fillStyle=pg;c.beginPath();c.arc(cx,cy,EH*1.35,0,TAU);c.fill();
      c.restore();
      // 사건의 지평선 (순흑 + soft edge)
      const ehg=c.createRadialGradient(cx,cy,0,cx,cy,EH*1.3);
      ehg.addColorStop(0,"#000");ehg.addColorStop(.72,"#000");ehg.addColorStop(1,"rgba(0,0,0,0)");
      c.fillStyle=ehg;c.beginPath();c.arc(cx,cy,EH*1.3,0,TAU);c.fill();
      // 특이점 미광
      c.save();c.globalCompositeOperation="screen";
      const sg=c.createRadialGradient(cx,cy,0,cx,cy,EH*.7);
      sg.addColorStop(0,"rgba(150,90,255,"+(.12+Math.sin(T*2)*.06+d.bhSurge*.3)+")");sg.addColorStop(1,"rgba(0,0,0,0)");
      c.fillStyle=sg;c.beginPath();c.arc(cx,cy,EH*.7,0,TAU);c.fill();
      c.restore();
    },hud(d){return"VORTEX · ★5 restored · "+d.fps+"FPS";}};
  })();

  /* ===== FX25 CMYK FRACTURE ===== */
  const FX25=(function(){
    const CMYK=["#00ffff","#ff00ff","#ffff00","#ff4488","#44ffcc","#ff8800"];
    return{init(d){d.frags=null;d.fracT=0;d.fracturing=false;d.ghosts=[];if(!d._castBound){d._castBound=e=>{const r=d.canvas.getBoundingClientRect();this.trigger(d,(e.clientX-r.left)*DPR,(e.clientY-r.top)*DPR);};d.canvas.addEventListener('click',d._castBound);}},
      trigger(d,x,y){d.tx=x;d.ty=y;},
      onResize(d){d.frags=null;},
    frame(d,dt){
      const c=d.ctx,W=d.W,H=d.H,cx=(d.tx!=null?d.tx:W/2),cy=(d.ty!=null?d.ty:H/2),T=d.t;
      if(!d.frags){
        d.frags=[];const cols=8,rows=10,tw=W/cols,th=H/rows;
        for(let r=0;r<rows;r++)for(let cc=0;cc<cols;cc++){
          const x=cc*tw,y=r*th,col=CMYK[Math.floor(sd(x+y*W+1)*CMYK.length)],n=(sd(x+y*W)-.5)*tw*.16;
          d.frags.push({pts:[[x,y],[x+tw+n,y],[x+n,y+th]],ox:x,oy:y,vx:0,vy:0,rot:0,rS:0,col,alpha:1,ex:false,delay:Math.sqrt((cc-cols/2)**2+(r-rows/2)**2)*8+(sd(x+y)*30)});
          d.frags.push({pts:[[x+tw,y],[x+tw+n,y+th],[x+n,y+th]],ox:x+tw*.5,oy:y+th*.5,vx:0,vy:0,rot:0,rS:0,col:CMYK[Math.floor(sd(x+y*W+2)*CMYK.length)],alpha:1,ex:false,delay:Math.sqrt((cc-cols/2)**2+(r-rows/2)**2)*8+(sd(x+y+1)*25)});
        }
      }
      if(d.burst>.5&&!d.fracturing){
        d.fracturing=true;d.fracT=0;
        for(const f of d.frags){
          const dx=f.ox-cx,dy=f.oy-cy,dd=Math.sqrt(dx*dx+dy*dy)+1,sp=1.4+sd(f.ox+f.oy)*5;
          f.vx=(dx/dd)*sp+(sd(f.ox)-.5)*.6;f.vy=(dy/dd)*sp+(sd(f.oy)-.5)*.6-sd(f.ox)*.8;
          f.rS=(sd(f.oy+f.ox)-.5)*.1;f.ex=true;
        }
        d.ghosts=[{dx:-7,dy:-3,col:"#ff0000",a:.3},{dx:7,dy:2,col:"#00ff00",a:.25},{dx:-4,dy:5,col:"#0000ff",a:.22}];
        setTimeout(()=>{d.fracturing=false;d.frags=null;d.ghosts=[];},3200);
      }
      if(d.bg===false){c.clearRect(0,0,W,H);}else{
      c.fillStyle="#0a0008";c.fillRect(0,0,W,H);
      // Halftone
      c.save();c.globalAlpha=.055;const sp2=13;
      for(let x=0;x<W;x+=sp2)for(let y=0;y<H;y+=sp2){const sz=(.5+.5*Math.sin(x*.04+T*.02)*Math.sin(y*.04))*3.5+.4;c.fillStyle="hsl("+(x*.5+y*.3)+",70%,58%)";c.beginPath();c.arc(x,y,sz,0,TAU);c.fill();}
      c.restore();}
      if(d.fracturing)d.fracT++;
      for(const g of d.ghosts){c.save();c.globalAlpha=g.a*.55;c.globalCompositeOperation="screen";c.fillStyle=g.col;c.fillRect(g.dx,g.dy,W,H);c.restore();}
      for(const f of d.frags){
        if(f.ex&&d.fracT>f.delay){f.ox+=f.vx;f.oy+=f.vy;f.vy+=.065;f.vx*=.975;f.rot+=f.rS;f.alpha=Math.max(0,f.alpha-.0045);}
        else if(!f.ex&&Math.random()<.001){f.ox+=(sd(f.ox+T)-.5)*4;setTimeout(()=>{},60);}
        if(f.alpha<.01)continue;
        c.save();c.translate(f.ox,f.oy);c.rotate(f.rot);c.globalAlpha=f.alpha;
        const p=f.pts;
        for(const[sh,cmp] of [[[-2,-1],"rgba(255,0,0,.14)"],[[2,1],"rgba(0,255,255,.14)"],[[0,0],f.col+"bb"]]){
          c.fillStyle=cmp;c.beginPath();c.moveTo(p[0][0]-f.ox+sh[0],p[0][1]-f.oy+sh[1]);c.lineTo(p[1][0]-f.ox+sh[0],p[1][1]-f.oy+sh[1]);c.lineTo(p[2][0]-f.ox+sh[0],p[2][1]-f.oy+sh[1]);c.closePath();c.fill();
        }
        c.strokeStyle="rgba(0,0,0,.82)";c.lineWidth=1.1;c.beginPath();c.moveTo(p[0][0]-f.ox,p[0][1]-f.oy);c.lineTo(p[1][0]-f.ox,p[1][1]-f.oy);c.lineTo(p[2][0]-f.ox,p[2][1]-f.oy);c.closePath();c.stroke();c.restore();
      }
      if(Math.floor(T*60)%120<4){c.save();c.globalAlpha=(4-Math.floor(T*60)%120)/4*.18;c.globalCompositeOperation="screen";c.fillStyle=CMYK[Math.floor(T*60/120)%CMYK.length];c.fillRect((sd(T)-.5)*8,(sd(T+1)-.5)*6,W,H);c.restore();}
    },hud(d){return"CMYK · "+d.fps+"FPS";}};
  })();

  /* ===== FX28 BLACK HOLE VORTEX (s2 원작 이식) — [v6.1 #16] ===== */
  /* vfx-report-s2.html SK-02 연출 그대로. class BHP → 배열 풀로 포팅 */
  const FX28=(function(){const N=320,EH_FRAC=.07;
    return{init(d){
      d.bhR=new Float32Array(N);d.bhT=new Float32Array(N);d.bhDR=new Float32Array(N);
      d.bhDT=new Float32Array(N);d.bhSz=new Float32Array(N);d.bhGold=new Uint8Array(N);
      d.bhA=new Float32Array(N);d.bhAge=new Float32Array(N);d.bhMax=new Float32Array(N);
      d.bhSurge=0;d.bhTick=0;d.bhLens=0;d.bhW=0;
      if(!d._castBound){d._castBound=e=>{const r=d.canvas.getBoundingClientRect();this.trigger(d,(e.clientX-r.left)*DPR,(e.clientY-r.top)*DPR);};d.canvas.addEventListener('click',d._castBound);}
    },
    trigger(d,x,y){d.tx=x;d.ty=y;},
    frame(d,dt){
      const c=d.ctx,W=d.W,H=d.H,T=d.t,cx=(d.tx!=null?d.tx:W*.5),cy=(d.ty!=null?d.ty:H*.5);
      const R=Math.min(W,H)*.44, EH=R*EH_FRAC;
      d.bhTick++;
      // burst → surge (s2: click→surge=1.8, 1.2s decay)
      if(d.burst>.6&&d.bhSurge<.5)d.bhSurge=1.8;
      d.bhSurge=Math.max(0,d.bhSurge-.012*(dt*60));
      const surge=d.bhSurge;
      // 입자 초기화 (resize 또는 첫 프레임)
      if(d.bhW!==W){d.bhW=W;
        for(let i=0;i<N;i++){
          const ring=Math.random()<.35;
          d.bhR[i]=ring?R*(.32+Math.random()*.16):R*(.35+Math.random()*.63);
          d.bhT[i]=Math.random()*TAU;
          d.bhDR[i]=-(.18+Math.random()*.67);
          d.bhDT[i]=(.008+Math.random()*.02)*(1+2/(d.bhR[i]/R+.01));
          d.bhSz[i]=.5+Math.random()*(ring?3.5:2);
          d.bhGold[i]=Math.random()<.3?1:0;
          d.bhAge[i]=0;d.bhMax[i]=Math.random()*200;
          d.bhA[i]=Math.random();
        }
      }
      // dark with trail (s2 원작: rgba(0,0,6,.22))
      if(d.bg===false){c.globalCompositeOperation="destination-out";c.fillStyle="rgba(0,0,0,.22)";c.fillRect(0,0,W,H);c.globalCompositeOperation="source-over";}else{c.fillStyle="rgba(0,0,6,.22)";c.fillRect(0,0,W,H);}
      // accretion disk glow (s2 4단)
      c.save();c.globalCompositeOperation="screen";
      for(const[dr,ba] of [[R*.55,.18],[R*.38,.3],[R*.22,.45],[R*.12,.6]]){
        const ag=c.createRadialGradient(cx,cy,EH*.7,cx,cy,dr);
        ag.addColorStop(0,"rgba(255,160,40,"+(ba*.4)+")");
        ag.addColorStop(.4,"rgba(80,30,160,"+(ba*.3)+")");
        ag.addColorStop(1,"rgba(0,0,0,0)");
        c.fillStyle=ag;c.fillRect(0,0,W,H);
      }
      // lensing rings (s2 원작: 3개)
      d.bhLens+=.006+surge*.01;
      for(let i=0;i<3;i++){
        const lr=EH*(1.8+i*.5),la=.15+i*.08*(Math.sin(d.bhTick*.04+i)*.5+.5);
        c.strokeStyle="rgba(255,200,80,"+(la*(1+surge*.4))+")";
        c.lineWidth=1+i*.3;c.shadowBlur=8;c.shadowColor="#ffaa30";
        c.beginPath();c.arc(cx,cy,lr,0,TAU);c.stroke();c.shadowBlur=0;
      }
      c.restore();
      // particles (s2 BHP update+draw)
      for(let i=0;i<N;i++){
        d.bhAge[i]++;
        d.bhT[i]+=d.bhDT[i]*(1+surge*.3);
        d.bhR[i]+=d.bhDR[i]*(1+surge*.4);
        d.bhDT[i]*=1.002; // accelerate
        if(d.bhA[i]<1)d.bhA[i]+=.04;
        if(d.bhR[i]<EH){
          const ring=Math.random()<.35;
          d.bhR[i]=ring?R*(.32+Math.random()*.16):R*(.35+Math.random()*.63);
          d.bhT[i]=Math.random()*TAU;d.bhDR[i]=-(.18+Math.random()*.67);
          d.bhDT[i]=(.008+Math.random()*.02)*(1+2/(d.bhR[i]/R+.01));
          d.bhSz[i]=.5+Math.random()*(ring?3.5:2);d.bhGold[i]=Math.random()<.3?1:0;
          d.bhAge[i]=0;d.bhMax[i]=80+Math.random()*160;d.bhA[i]=0;
        }
        const x=cx+Math.cos(d.bhT[i])*d.bhR[i],y=cy+Math.sin(d.bhT[i])*d.bhR[i];
        const ef=Math.max(0,Math.min(1,(d.bhR[i]-20)/80));
        const a=d.bhA[i]*ef*.85;
        if(a<.02)continue;
        if(d.bhGold[i]){c.fillStyle="rgba(255,190,60,"+a+")";}
        else{const t2=Math.max(0,Math.min(1,1-d.bhR[i]/(W*.44)));
          c.fillStyle="rgba("+(30+t2*180|0)+","+(60+t2*60|0)+","+(180-t2*80|0)+","+a+")";}
        c.beginPath();c.arc(x,y,d.bhSz[i],0,TAU);c.fill();
      }
      // event horizon — absolute black (s2)
      const ehg=c.createRadialGradient(cx,cy,0,cx,cy,EH*1.5);
      ehg.addColorStop(0,"rgba(0,0,0,1)");ehg.addColorStop(.65,"rgba(0,0,0,1)");ehg.addColorStop(1,"rgba(0,0,0,0)");
      c.fillStyle=ehg;c.fillRect(0,0,W,H);
      // singularity shimmer (s2)
      if(d.bhTick%2===0&&Math.random()<.5){
        c.save();c.globalCompositeOperation="screen";
        const sg=c.createRadialGradient(cx,cy,0,cx,cy,EH*.9);
        sg.addColorStop(0,"rgba(150,80,255,"+((.1+Math.sin(d.bhTick*.08)*.06)*(1+surge*.6))+")");
        sg.addColorStop(1,"rgba(0,0,0,0)");
        c.fillStyle=sg;c.fillRect(0,0,W,H);c.restore();
      }
    },hud(d){return"VORTEX-S2 · 원작이식 · "+d.fps+"FPS";}};
  })();


  /* ===== FXc1-c6: MC 마스터캔버스 effects — makeDemo wrappers ===== */
  /* DPR 보정: ctx.setTransform(DPR,...) → CSS pixel 좌표로 기존 코드 재사용 */

  const FXc1=(function(){
    return{
      init(d){
        d._tick=0;
        const DPRv=DPR;
        class Mote{
          init(){
            const w=d.W/DPRv,h=d.H/DPRv,cx=(d.tx!=null?d.tx:w*.5),cy=(d.ty!=null?d.ty:h*.76);
            const r=rand(0,52),a=rand(-Math.PI,0);
            this.x=cx+Math.cos(a)*r;this.y=cy+rand(-12,12);
            this.vx=rand(-.25,.25);this.vy=-rand(.45,2.1);
            this.ph=rand(0,PI2);this.t=0;this.max=rand(75,210);
            this.blob=Math.random()<.27;
            this.sz=this.blob?rand(18,55):rand(1.2,6);
            this.hue=rand(196,238);
          }
          constructor(){this.init();this.t=rand(0,210);}
          update(){
            const w=d.W/DPRv,h=d.H/DPRv;
            this.t++;this.ph+=.028;
            this.x+=this.vx+Math.sin(this.ph)*.26;this.y+=this.vy;
            this.vx*=.975;this.vy=clamp(this.vy-.0018,-4,-.05);
            const mx=d.mOn?d.mx/DPRv:null,my=d.mOn?d.my/DPRv:null;
            if(mx!==null){const dx=this.x-mx,dy=this.y-my,d2=dx*dx+dy*dy;if(d2<8100&&d2>.01){const dd=Math.sqrt(d2),f=(90-dd)/90*.52;this.vx+=dx/dd*f;this.vy+=dy/dd*f;}}
            if(this.t>=this.max)this.init();
          }
          draw(){
            const ctx=d.ctx,p=this.t/this.max,a=Math.sin(p*Math.PI)*(this.blob?.17:.88);
            if(this.blob){
              const g=ctx.createRadialGradient(this.x,this.y,0,this.x,this.y,this.sz);
              g.addColorStop(0,`hsla(${this.hue},72%,94%,${a})`);g.addColorStop(.45,`hsla(${this.hue},80%,72%,${a*.35})`);g.addColorStop(1,'hsla(0,0%,0%,0)');
              ctx.fillStyle=g;ctx.beginPath();ctx.arc(this.x,this.y,this.sz,0,PI2);ctx.fill();
            }else{
              ctx.shadowBlur=18;ctx.shadowColor=`hsl(${this.hue},100%,82%)`;
              ctx.fillStyle=`hsla(${this.hue},90%,96%,${a})`;
              ctx.beginPath();ctx.arc(this.x,this.y,this.sz,0,PI2);ctx.fill();
              ctx.shadowBlur=0;
            }
          }
        }
        d._motes=Array.from({length:220},()=>new Mote());
        if(!d._castBound){d._castBound=e=>{const r=d.canvas.getBoundingClientRect();this.trigger(d,e.clientX-r.left,e.clientY-r.top);};d.canvas.addEventListener('click',d._castBound);}
      },
      trigger(d,x,y){d.tx=x;d.ty=y;},
      frame(d){
        d._tick++;
        const ctx=d.ctx;
        ctx.setTransform(DPR,0,0,DPR,0,0);
        const w=d.W/DPR,h=d.H/DPR,cx=(d.tx!=null?d.tx:w*.5),cy=(d.ty!=null?d.ty:h*.76),tick=d._tick;
        if(d.bg===false){ctx.globalCompositeOperation="destination-out";ctx.fillStyle="rgba(0,0,0,0.12)";ctx.fillRect(0,0,w,h);ctx.globalCompositeOperation="source-over";}else{ctx.fillStyle='rgba(0,0,8,0.12)';ctx.fillRect(0,0,w,h);}
        ctx.save();ctx.globalCompositeOperation='screen';
        for(const[rr,ba] of [[130,.17],[70,.32],[24,.6]]){
          const pulse=rr+Math.sin(tick*.025+rr)*14;
          const g=ctx.createRadialGradient(cx,cy,0,cx,cy,pulse);
          g.addColorStop(0,`rgba(160,215,255,${ba})`);g.addColorStop(.5,`rgba(80,155,255,${ba*.3})`);g.addColorStop(1,'rgba(0,0,0,0)');
          ctx.fillStyle=g;ctx.fillRect(0,0,w,h);
        }
        ctx.save();ctx.globalCompositeOperation='screen';
        const bloomR=Math.min(w,h)*(.42+Math.sin(tick*.02)*.05);
        const bg2=ctx.createRadialGradient(cx,cy,0,cx,cy,bloomR);
        bg2.addColorStop(0,'rgba(190,225,255,0.28)');bg2.addColorStop(.4,'rgba(110,175,255,0.10)');bg2.addColorStop(1,'rgba(0,0,0,0)');
        ctx.fillStyle=bg2;ctx.beginPath();ctx.arc(cx,cy,bloomR,0,PI2);ctx.fill();
        ctx.restore();
        if(d.burst>0.5){for(let i=0;i<8;i++){const a=rand(0,PI2),r=rand(20,120);const mx=cx+Math.cos(a)*r,my=cy+Math.sin(a)*r;const mb=d._motes[Math.floor(Math.random()*d._motes.length)];mb.x=mx;mb.y=my;mb.vx=(Math.random()-.5)*4;mb.vy=-rand(2,6);mb.t=0;}}
        for(const m of d._motes){m.update();m.draw();}
        const sz=33+Math.sin(tick*.07)*9;
        const cg=ctx.createRadialGradient(cx,cy,0,cx,cy,sz);
        cg.addColorStop(0,'rgba(255,255,255,1)');cg.addColorStop(.18,'rgba(210,238,255,0.82)');cg.addColorStop(.55,'rgba(110,185,255,0.22)');cg.addColorStop(1,'rgba(0,0,0,0)');
        ctx.shadowBlur=40;ctx.shadowColor='rgba(100,200,255,0.8)';
        ctx.fillStyle=cg;ctx.beginPath();ctx.arc(cx,cy,sz,0,PI2);ctx.fill();
        ctx.shadowBlur=0;ctx.restore();
        ctx.setTransform(1,0,0,1,0,0);
      },
      hud(d){return'NEBULA · '+d.fps+'FPS';}
    };
  })();

  const FXc2=(function(){
    return{
      init(d){
        d._tick=0;d._modeFlip=0;d._impX=0;d._impY=0;d._impMode=1;d._impAge=9999;
        d._ripples=[];d._glitches=[];
        // clear any previous timers
        if(d._autoT){clearTimeout(d._autoT);d._autoT=null;}
        if(d._autoI){clearInterval(d._autoI);d._autoI=null;}
        // auto trigger — only when visible
        d._autoT=setTimeout(()=>{if(d.playing&&d.visible){const w=d.W/DPR,h=d.H/DPR;_c2trigger(d,w*.5+rand(-70,70),h*.5+rand(-50,50));}},1200);
        d._autoI=setInterval(()=>{if(d.playing&&d.visible){const w=d.W/DPR,h=d.H/DPR;_c2trigger(d,w*.5+rand(-90,90),h*.5+rand(-70,70));}},4200);
        // canvas click — guard duplicate listeners
        if(!d._c2clickBound){d._c2clickBound=e=>{const r=d.canvas.getBoundingClientRect();_c2trigger(d,e.clientX-r.left,e.clientY-r.top);};d.canvas.addEventListener('click',d._c2clickBound);}
      },
      frame(d){
        d._tick++;d._impAge++;
        if(d.burst>0.5){const w=d.W/DPR,h=d.H/DPR;_c2trigger(d,w*.5+rand(-60,60),h*.5+rand(-50,50));}
        const ctx=d.ctx;
        ctx.setTransform(DPR,0,0,DPR,0,0);
        const w=d.W/DPR,h=d.H/DPR,cx=w*.5,cy=h*.5,HSZ=21,HW=HSZ*2,HH=Math.sqrt(3)*HSZ;
        const isActive=d._impAge<100;
        if(d.bg===false){ctx.clearRect(0,0,w,h);}else{
        const bg=ctx.createRadialGradient(cx,cy*.4,0,cx,cy*.4,Math.max(w,h));
        bg.addColorStop(0,'#080610');bg.addColorStop(.5,'#060408');bg.addColorStop(1,'#030208');
        ctx.fillStyle=bg;ctx.fillRect(0,0,w,h);}
        const SHIELDR=Math.min(w,h)*.41;
        ctx.save();ctx.beginPath();ctx.arc(cx,cy,SHIELDR,0,PI2);ctx.clip();
        const cols=Math.ceil(SHIELDR/(HW*.75))+2,rows=Math.ceil(SHIELDR/HH)+2;
        for(let col=-cols;col<=cols;col++){
          for(let row=-rows;row<=rows;row++){
            const hx=col*HW*.75,hy=row*HH+(((col%2)+2)%2)*HH*.5;
            const ax=cx+hx,ay=cy+hy;
            if(Math.sqrt((ax-cx)**2+(ay-cy)**2)>SHIELDR+HSZ)continue;
            const dI=Math.sqrt((ax-d._impX)**2+(ay-d._impY)**2);
            const waveFront=(d._impAge/100)*260,wA=Math.max(0,1-Math.abs(dI-waveFront)/28);
            let sA=.055,sR=80,sG=140,sB=255,fA=0;
            if(isActive){sA+=wA*.55;if(dI<85){const prox=(1-dI/85)*Math.max(0,1-d._impAge/65);if(d._impMode===1){sR=50;sG=160;sB=255;sA+=prox*.7;fA=prox*.09;}else{sR=255;sG=35;sB=55;sA+=prox*.75;fA=prox*.12;}}}
            ctx.beginPath();
            for(let i=0;i<6;i++){const a=Math.PI/3*i-Math.PI/6;i===0?ctx.moveTo(ax+HSZ*Math.cos(a),ay+HSZ*Math.sin(a)):ctx.lineTo(ax+HSZ*Math.cos(a),ay+HSZ*Math.sin(a));}
            ctx.closePath();
            if(isActive&&wA>.2){ctx.shadowBlur=12;ctx.shadowColor=d._impMode===2?'rgba(255,30,50,.8)':'rgba(50,140,255,.8)';}
            ctx.strokeStyle=`rgba(${sR},${sG},${sB},${Math.min(sA,.95)})`;ctx.lineWidth=.75;ctx.stroke();
            if(fA>0){ctx.fillStyle=d._impMode===2?`rgba(255,35,55,${fA})`:`rgba(50,140,255,${fA})`;ctx.fill();}
            ctx.shadowBlur=0;
          }
        }
        ctx.restore();
        ctx.save();ctx.globalCompositeOperation='screen';
        const rimP=isActive?.45+Math.sin(d._impAge*.3)*.2:.10+Math.sin(d._tick*.04)*.04;
        const rimC=isActive&&d._impMode===2?'#ff2840':'#2888ff';
        ctx.shadowBlur=isActive?32:8;ctx.shadowColor=rimC;
        ctx.strokeStyle=isActive&&d._impMode===2?`rgba(255,40,60,${rimP})`:`rgba(50,140,255,${rimP})`;
        ctx.lineWidth=isActive?2.2:1;ctx.beginPath();ctx.arc(cx,cy,SHIELDR,0,PI2);ctx.stroke();ctx.shadowBlur=0;
        /* [FIX] filter→인플레이스 역방향 splice */
        for(let _i=d._ripples.length-1;_i>=0;_i--){if(!(d._ripples[_i].life<d._ripples[_i].max))d._ripples.splice(_i,1);}
        for(const rp of d._ripples){rp.life++;rp.r=(rp.life/rp.max)*200;const a=1-rp.life/rp.max;ctx.shadowBlur=18;ctx.shadowColor=rp.mode===2?'#ff2840':'#2888ff';ctx.strokeStyle=rp.mode===2?`rgba(255,40,70,${a*.85})`:`rgba(50,140,255,${a*.85})`;ctx.lineWidth=2;ctx.beginPath();ctx.arc(rp.x,rp.y,rp.r,0,PI2);ctx.stroke();ctx.shadowBlur=0;}
        ctx.restore();
        /* [FIX] filter→인플레이스 역방향 splice */
        for(let _i=d._glitches.length-1;_i>=0;_i--){if(!(d._glitches[_i].life<d._glitches[_i].max))d._glitches.splice(_i,1);}
        for(const g of d._glitches){g.life++;if(g.life%2===0){const a=(1-g.life/g.max)*.75;ctx.fillStyle=g.mode===2?`rgba(255,35,55,${a})`:`rgba(50,140,255,${a})`;ctx.fillRect(g.x,g.y,g.w,g.h);}}
        ctx.setTransform(1,0,0,1,0,0);
      },
      hud(d){return'SHIELD · '+d.fps+'FPS';}
    };
  })();
  function _c2trigger(d,x,y){
    if(!d.visible)return;
    /* [FIX] trigger 시 filter→인플레이스 splice (클릭 이벤트, 저빈도지만 원칙 통일) */
    for(let _i=d._ripples.length-1;_i>=0;_i--){if(!(d._ripples[_i].life<d._ripples[_i].max))d._ripples.splice(_i,1);}
    for(let _i=d._glitches.length-1;_i>=0;_i--){if(!(d._glitches[_i].life<d._glitches[_i].max))d._glitches.splice(_i,1);}
    if(d._ripples.length>8)return;
    d._impMode=d._modeFlip%2===0?1:2;d._modeFlip++;d._impX=x;d._impY=y;d._impAge=0;
    d._ripples.push({x,y,r:0,life:0,max:65,mode:d._impMode});
    for(let i=0;i<14;i++)d._glitches.push({x:x+rand(-100,100),y:y+rand(-100,100),w:rand(10,44),h:rand(4,18),life:0,max:rand(8,28),mode:d._impMode});
  }

  const FXc3=(function(){
    const RINGS=[{r:.28,n:6,spd:.009,lw:2},{r:.62,n:8,spd:-.006,lw:1.6},{r:1.0,n:12,spd:.004,lw:1.2},{r:1.42,n:16,spd:-.003,lw:1},{r:1.82,n:24,spd:.002,lw:.7}];
    return{
      init(d){
        d._tick=0;d._sparks=[];d._angs=RINGS.map(()=>0);
        d.canvas.addEventListener('click',e=>{
          const r=d.canvas.getBoundingClientRect();
          const cx=e.clientX-r.left,cy=e.clientY-r.top;
          this.trigger(d,cx,cy);
          _c3addSparks(d,cx,cy,20,true);
        });
        d.canvas.addEventListener('touchend',e=>{
          e.preventDefault();
          if(e.changedTouches.length){
            const r=d.canvas.getBoundingClientRect(),t=e.changedTouches[0];
            const cx=t.clientX-r.left,cy=t.clientY-r.top;
            this.trigger(d,cx,cy);
            _c3addSparks(d,cx,cy,20,true);
          }
        },{passive:false});
      },
      trigger(d,x,y){d.tx=x;d.ty=y;},
      frame(d){
        d._tick++;
        const w0=d.W/DPR,h0=d.H/DPR;
        if(d.burst>0.5){_c3addSparks(d,d.tx!=null?d.tx:w0*.5,d.ty!=null?d.ty:h0*.5,60,true);}
        const ctx=d.ctx;
        ctx.setTransform(DPR,0,0,DPR,0,0);
        const w=d.W/DPR,h=d.H/DPR,cx=(d.tx!=null?d.tx:w*.5),cy=(d.ty!=null?d.ty:h*.5),tick=d._tick,S=Math.min(w,h);
        const ringR=RINGS.map((r,i)=>r.r*S*.1);
        if(d.bg===false){ctx.globalCompositeOperation="destination-out";ctx.fillStyle="rgba(0,0,0,0.16)";ctx.fillRect(0,0,w,h);ctx.globalCompositeOperation="source-over";}else{ctx.fillStyle='rgba(4,2,0,0.16)';ctx.fillRect(0,0,w,h);}
        ctx.save();ctx.globalCompositeOperation='screen';
        const aG=ctx.createRadialGradient(cx,cy,0,cx,cy,200);
        const ap=.025+Math.sin(tick*.035)*.01;
        aG.addColorStop(0,`rgba(255,110,20,${ap*2.5})`);aG.addColorStop(.5,`rgba(180,55,5,${ap})`);aG.addColorStop(1,'rgba(0,0,0,0)');
        ctx.fillStyle=aG;ctx.fillRect(0,0,w,h);ctx.restore();
        ctx.save();ctx.globalCompositeOperation='screen';ctx.translate(cx,cy);
        const paramSpd=.5+d.param*1.5;
        RINGS.forEach((ring,ri)=>{
          d._angs[ri]+=ring.spd*paramSpd;
          const ang=d._angs[ri],rr=ringR[ri],npos=[];
          for(let ni=0;ni<ring.n;ni++){const a=ang+(PI2/ring.n)*ni;npos.push([Math.cos(a)*rr,Math.sin(a)*rr]);}
          const rp=.38+Math.sin(tick*.04+ri*.7)*.14,hue=38-ri*4;
          ctx.strokeStyle=`hsla(${hue},100%,${58+ri}%,${rp*.32})`;ctx.lineWidth=ring.lw;
          ctx.shadowBlur=14;ctx.shadowColor=`hsl(${hue},100%,55%)`;
          ctx.beginPath();ctx.arc(0,0,rr,0,PI2);ctx.stroke();ctx.shadowBlur=0;
          const skip=ri%2===0?2:3;
          for(let ni=0;ni<ring.n;ni++){
            const[x1,y1]=npos[ni],[x2,y2]=npos[(ni+skip)%ring.n];
            const la=.28+Math.sin(tick*.038+ni+ri)*.12;
            ctx.strokeStyle=`hsla(${hue-5},100%,62%,${la})`;ctx.lineWidth=.75;
            ctx.shadowBlur=7;ctx.shadowColor=`hsl(${hue},100%,60%)`;
            ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();ctx.shadowBlur=0;
          }
          for(const[nx,ny] of npos){const dp=.65+Math.sin(tick*.09+ri)*.28;ctx.fillStyle=`hsla(${hue+8},100%,82%,${dp})`;ctx.shadowBlur=10;ctx.shadowColor=`hsl(${hue+8},100%,70%)`;ctx.beginPath();ctx.arc(nx,ny,2.2,0,PI2);ctx.fill();ctx.shadowBlur=0;}
          if(ri===RINGS.length-1&&tick%2===0){const ni=Math.floor(rand(0,ring.n));const[nx,ny]=npos[ni];_c3addSparks(d,cx+nx,cy+ny,1,false);}
        });
        const csz=10+Math.sin(tick*.08)*4.5;
        const cg=ctx.createRadialGradient(0,0,0,0,0,csz);
        cg.addColorStop(0,'rgba(255,255,190,1)');cg.addColorStop(.3,'rgba(255,160,50,.75)');cg.addColorStop(1,'rgba(0,0,0,0)');
        ctx.shadowBlur=30;ctx.shadowColor='#ff9030';ctx.fillStyle=cg;ctx.beginPath();ctx.arc(0,0,csz,0,PI2);ctx.fill();ctx.shadowBlur=0;
        ctx.restore();
        ctx.save();ctx.globalCompositeOperation='screen';
        /* [FIX] filter()→인플레이스 역방향 splice */
        for(let _i=d._sparks.length-1;_i>=0;_i--){if(d._sparks[_i].t>=d._sparks[_i].max)d._sparks.splice(_i,1);}
        for(const sp of d._sparks){sp.t++;sp.x+=sp.vx;sp.y+=sp.vy;sp.vx*=.978;sp.vy+=.045;const p=sp.t/sp.max,a=Math.sin(p*Math.PI)*.9,sz=Math.max(sp.sz*(1-p*.65),.4);ctx.fillStyle=`hsla(${sp.hue},100%,${62+p*28}%,${a})`;ctx.beginPath();ctx.arc(sp.x,sp.y,sz,0,PI2);ctx.fill();}
        ctx.restore();
        // canvas click → burst at click pos
        ctx.setTransform(1,0,0,1,0,0);
      },
      hud(d){return'MANDALA · '+d.fps+'FPS';}
    };
  })();
  function _c3addSparks(d,x,y,count,burst){for(let i=0;i<count&&d._sparks.length<280;i++){const a=rand(0,PI2),sp=burst?rand(2.5,9):rand(.4,2.8);d._sparks.push({x,y,vx:Math.cos(a)*sp+rand(-.3,.3),vy:Math.sin(a)*sp-(burst?rand(1,4):rand(.1,.8)),t:0,max:rand(38,burst?90:130),sz:rand(1,burst?5:3.5),hue:rand(18,52)});}}

  const FXc4=(function(){
    return{
      init(d){
        d._tick=0;d._isDown=false;d._path=[];d._slashes=[];d._shocks=[];
        d._dust=Array.from({length:70},()=>({x:Math.random(),y:Math.random(),vx:rand(-.00025,.00025),vy:rand(-.00015,.00015),sz:rand(.4,1.8),a:rand(.04,.22)}));
        const cv=d.canvas;
        function gp(e){const r=cv.getBoundingClientRect();const s=e.touches?e.touches[0]:e;return[s.clientX-r.left,s.clientY-r.top];}
        function fin(){if(d._path.length>3){const mx=d._path.reduce((s,p)=>s+p[0],0)/d._path.length;const my=d._path.reduce((s,p)=>s+p[1],0)/d._path.length;d._slashes.push({pts:[...d._path],t:0,max:95});d._shocks.push({x:mx,y:my,t:0,max:65});}d._path=[];d._isDown=false;}
        cv.addEventListener('mousedown',e=>{if(!d.playing)return;d._isDown=true;d._path=[gp(e)];});
        cv.addEventListener('mousemove',e=>{if(d._isDown)d._path.push(gp(e));});
        cv.addEventListener('mouseup',fin);cv.addEventListener('mouseleave',fin);
        cv.addEventListener('touchstart',e=>{e.preventDefault();if(!d.playing)return;d._isDown=true;d._path=[gp(e)];},{passive:false});
        cv.addEventListener('touchmove',e=>{e.preventDefault();if(d._isDown)d._path.push(gp(e));},{passive:false});
        cv.addEventListener('touchend',e=>{e.preventDefault();fin();},{passive:false});
        setTimeout(()=>{if(!d.playing)return;const w=d.W/DPR,h=d.H/DPR,steps=22,pts=[];for(let i=0;i<=steps;i++){const p=i/steps;pts.push([w*(.18+p*.64),h*(.28+p*.44)]);}d._slashes.push({pts,t:0,max:95});d._shocks.push({x:w*.5,y:h*.5,t:0,max:65});},1200);
      },
      frame(d){
        d._tick++;
        if(d.burst>0.5){const w=d.W/DPR,h=d.H/DPR,steps=18,pts=[];for(let i=0;i<=steps;i++){const p=i/steps,jx=(Math.random()-.5)*w*.06;pts.push([w*(.15+p*.7)+jx,h*(.25+p*.5)]);}d._slashes.push({pts,t:0,max:95});d._shocks.push({x:w*.5,y:h*.5,t:0,max:65});}
        const ctx=d.ctx;
        ctx.setTransform(DPR,0,0,DPR,0,0);
        const w=d.W/DPR,h=d.H/DPR;
        if(d.bg===false){ctx.globalCompositeOperation="destination-out";ctx.fillStyle="rgba(0,0,0,0.22)";ctx.fillRect(0,0,w,h);ctx.globalCompositeOperation="source-over";}else{ctx.fillStyle='rgba(7,7,9,0.22)';ctx.fillRect(0,0,w,h);}
        ctx.save();ctx.strokeStyle='rgba(255,255,255,0.012)';ctx.lineWidth=.5;
        const gs=45;
        for(let x=0;x<w;x+=gs){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,h);ctx.stroke();}
        for(let y=0;y<h;y+=gs){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke();}
        ctx.restore();
        for(const dd of d._dust){dd.x+=dd.vx;dd.y+=dd.vy;if(dd.x<0)dd.x=1;if(dd.x>1)dd.x=0;if(dd.y<0)dd.y=1;if(dd.y>1)dd.y=0;ctx.fillStyle=`rgba(180,180,190,${dd.a})`;ctx.beginPath();ctx.arc(dd.x*w,dd.y*h,dd.sz,0,PI2);ctx.fill();}
        /* [FIX] filter()→인플레이스 역방향 splice */
        for(let _i=d._slashes.length-1;_i>=0;_i--){if(d._slashes[_i].t>=d._slashes[_i].max)d._slashes.splice(_i,1);}
        function drawSlash(pts,alpha){if(pts.length<2)return;for(const[blur,lw,am] of [[35,16,.22],[18,8,.45],[7,3.5,.72],[0,1.2,1.0]]){ctx.save();ctx.shadowBlur=blur;ctx.shadowColor=`rgba(255,0,30,${alpha})`;const a=alpha*am,g=Math.floor(20+am*90),b=Math.floor(am*80);ctx.strokeStyle=`rgba(255,${g},${b},${a})`;ctx.lineWidth=lw;ctx.lineCap='round';ctx.lineJoin='round';ctx.beginPath();ctx.moveTo(pts[0][0],pts[0][1]);for(let i=1;i<pts.length;i++)ctx.lineTo(pts[i][0],pts[i][1]);ctx.stroke();ctx.restore();}}
        for(const sl of d._slashes){sl.t++;drawSlash(sl.pts,1-sl.t/sl.max);}
        if(d._isDown&&d._path.length>1)drawSlash(d._path,1);
        /* [FIX] filter()→인플레이스 역방향 splice */
        for(let _i=d._shocks.length-1;_i>=0;_i--){if(d._shocks[_i].t>=d._shocks[_i].max)d._shocks.splice(_i,1);}
        ctx.save();ctx.globalCompositeOperation='screen';
        for(const sw of d._shocks){sw.t++;const p=sw.t/sw.max,sr=p*170,a=1-p;ctx.shadowBlur=22;ctx.shadowColor='#ff2040';ctx.strokeStyle=`rgba(255,40,60,${a*.8})`;ctx.lineWidth=2.2;ctx.beginPath();ctx.arc(sw.x,sw.y,sr,0,PI2);ctx.stroke();ctx.shadowBlur=0;}
        ctx.restore();
        ctx.setTransform(1,0,0,1,0,0);
      },
      hud(d){return'VOID SLASH · '+d.fps+'FPS';}
    };
  })();

  const FXc5=(function(){
    // depth=5 for dense branching, capped segment count
    function gSeg(x1,y1,x2,y2,depth,jit){
      if(depth<=0)return[{x1,y1,x2,y2}];
      const mx=(x1+x2)/2+rand(-jit,jit),my=(y1+y2)/2+rand(-jit,jit);
      const s=[...gSeg(x1,y1,mx,my,depth-1,jit*.62),...gSeg(mx,my,x2,y2,depth-1,jit*.62)];
      // aggressive branching at depth 3 & 4
      if(depth>=3&&Math.random()<.35){
        const bx=mx+rand(-70,70),by=my+rand(-20,80);
        s.push(...gSeg(mx,my,bx,by,depth-2,jit*.5));
      }
      if(depth===4&&Math.random()<.20){
        const bx2=mx+rand(-90,90),by2=my+rand(10,100);
        s.push(...gSeg(mx,my,bx2,by2,depth-2,jit*.4));
      }
      return s;
    }
    return{
      init(d){
        d._tick=0;d._lightnings=[];d._storm=0;d._nextAuto=60;
        if(d._autoI){clearInterval(d._autoI);}
        d._autoI=setInterval(()=>{if(d.playing&&d.visible)_c5discharge(d,true);},2800);
        setTimeout(()=>{if(d.playing)_c5discharge(d,true);},400);
        d.canvas.addEventListener('click',()=>{if(d.playing)_c5discharge(d,true);});
      },
      frame(d){
        d._tick++;
        if(d.burst>0.5)_c5discharge(d,true);
        // auto-storm: continuous small bolts
        d._nextAuto--;
        if(d._nextAuto<=0){d._nextAuto=18+Math.floor(Math.random()*22);_c5discharge(d,false);}
        const ctx=d.ctx;
        ctx.setTransform(DPR,0,0,DPR,0,0);
        const w=d.W/DPR,h=d.H/DPR,cx=w*.5,oy=h*.16,tick=d._tick;
        // dark storm sky
        ctx.fillStyle='rgba(3,2,1,0.35)';ctx.fillRect(0,0,w,h);
        // storm atmosphere glow
        ctx.save();ctx.globalCompositeOperation='screen';
        const stormP=.3+.2*Math.sin(tick*.025);
        const atm=ctx.createRadialGradient(cx,h*.3,0,cx,h*.5,Math.max(w,h)*.7);
        atm.addColorStop(0,`rgba(255,200,50,${stormP*.12})`);atm.addColorStop(.4,`rgba(180,140,20,${stormP*.06})`);atm.addColorStop(1,'rgba(0,0,0,0)');
        ctx.fillStyle=atm;ctx.fillRect(0,0,w,h);
        // charge field shimmer lines
        for(let i=0;i<6;i++){
          const ly=h*(.05+i*.16)+Math.sin(tick*.04+i)*8;
          const la=.04+.03*Math.sin(tick*.06+i*1.1);
          ctx.strokeStyle=`rgba(255,220,80,${la})`;ctx.lineWidth=.5;
          ctx.beginPath();ctx.moveTo(0,ly);ctx.lineTo(w,ly);ctx.stroke();
        }
        ctx.restore();
        // storm clouds (denser)
        ctx.save();
        for(let i=0;i<9;i++){
          const cx2=w*(.05+i*.11),cy2=h*(.04+Math.sin(tick*.006+i*1.1)*.04),cr=60+i*9;
          const cg=ctx.createRadialGradient(cx2,cy2,0,cx2,cy2,cr);
          cg.addColorStop(0,`rgba(20,16,6,${.45+i*.02})`);cg.addColorStop(1,'rgba(0,0,0,0)');
          ctx.fillStyle=cg;ctx.beginPath();ctx.arc(cx2,cy2,cr,0,PI2);ctx.fill();
        }
        ctx.restore();
        // ground strike glow
        ctx.save();ctx.globalCompositeOperation='screen';
        const gnd=ctx.createLinearGradient(0,h*.75,0,h);
        gnd.addColorStop(0,'rgba(255,200,50,.0)');gnd.addColorStop(1,`rgba(255,180,30,${.05+.04*Math.sin(tick*.05)})`);
        ctx.fillStyle=gnd;ctx.fillRect(0,h*.75,w,h*.25);
        ctx.restore();
        // subtle top charge edge (no orbs)
        ctx.save();ctx.globalCompositeOperation='screen';
        const edgeGlow=ctx.createLinearGradient(0,0,0,oy*2.2);
        edgeGlow.addColorStop(0,`rgba(255,220,60,.08)`);edgeGlow.addColorStop(1,'rgba(0,0,0,0)');
        ctx.fillStyle=edgeGlow;ctx.fillRect(0,0,w,oy*2.2);
        ctx.restore();

        // lightning bolts
        /* [FIX] filter()→인플레이스 역방향 splice */
        for(let _i=d._lightnings.length-1;_i>=0;_i--){if(d._lightnings[_i].t>=d._lightnings[_i].max)d._lightnings.splice(_i,1);}
        if(d._lightnings.length>0){
          ctx.save();ctx.globalCompositeOperation='screen';ctx.lineCap='round';
          for(const l of d._lightnings){
            l.t++;if(Math.random()<(l.big?.14:.30))continue;
            const a=(1-l.t/l.max);
            const isGold=l.gold;
            // outer glow
            ctx.shadowBlur=isGold?22:14;
            ctx.shadowColor=isGold?`rgba(255,200,20,${a})`:`rgba(180,220,255,${a})`;
            ctx.strokeStyle=isGold?`rgba(255,190,30,${a*.9})`:`rgba(180,210,255,${a*.7})`;
            ctx.lineWidth=l.big?(1.6+a*.8):(0.8+a*.4);
            ctx.beginPath();
            for(const seg of l.segs){ctx.moveTo(seg.x1,seg.y1);ctx.lineTo(seg.x2,seg.y2);}
            ctx.stroke();
            // bright core
            ctx.shadowBlur=0;
            ctx.strokeStyle=isGold?`rgba(255,250,180,${a})`:`rgba(220,240,255,${a*.9})`;
            ctx.lineWidth=l.big?.7:.3;
            ctx.beginPath();
            for(const seg of l.segs){ctx.moveTo(seg.x1,seg.y1);ctx.lineTo(seg.x2,seg.y2);}
            ctx.stroke();
          }
          ctx.restore();
        }
        ctx.setTransform(1,0,0,1,0,0);
      },
      hud(d){return'GOLDEN STORM · '+d.fps+'FPS';}
    };
  })();
  function _c5discharge(d,big){
    const w=d.W/DPR,h=d.H/DPR,oy=h*.16;
    const maxPool=big?12:8;
    if(d._lightnings.length>=maxPool)return;
    function gS(x1,y1,x2,y2,dep,jit){
      if(dep<=0)return[{x1,y1,x2,y2}];
      const mx=(x1+x2)/2+rand(-jit,jit),my=(y1+y2)/2+rand(-jit,jit);
      const s=[...gS(x1,y1,mx,my,dep-1,jit*.62),...gS(mx,my,x2,y2,dep-1,jit*.62)];
      if(dep>=3&&Math.random()<.52){const bx=mx+rand(-80,80),by=my+rand(-15,90);s.push(...gS(mx,my,bx,by,dep-2,jit*.5));}
      if(dep>=4&&Math.random()<.32){const bx2=mx+rand(-100,100),by2=my+rand(10,110);s.push(...gS(mx,my,bx2,by2,dep-2,jit*.4));}
      return s;
    }
    const chargeX=[w*.25,w*.5,w*.75];
    if(big){
      // full discharge: all charge points + extras
      for(const ox of chargeX){
        d._lightnings.push({segs:gS(ox+rand(-15,15),oy,ox+rand(-120,120),h*rand(.50,.98),5,65),t:0,max:rand(14,28),gold:true,big:true});
        if(Math.random()<.6)d._lightnings.push({segs:gS(ox+rand(-20,20),oy,ox+rand(-80,80),h*rand(.5,.88),4,45),t:0,max:rand(12,24),gold:Math.random()<.6,big:false});
      }
      // cross-strike bonus
      for(let k=0;k<3;k++){
        const ox=rand(w*.1,w*.9);
        d._lightnings.push({segs:gS(rand(w*.2,w*.8),oy,ox,h*rand(.45,.9),4,50),t:0,max:rand(10,22),gold:Math.random()<.7,big:false});
      }

    } else {
      // mini bolt
      const ox=chargeX[Math.floor(Math.random()*chargeX.length)];
      d._lightnings.push({segs:gS(ox+rand(-12,12),oy,ox+rand(-60,60),h*rand(.45,.82),4,38),t:0,max:rand(10,20),gold:Math.random()<.5,big:false});

    }
  }

  const FXc6=(function(){
    const SIGILS_O=['Ψ','Σ','Φ','Ω','Δ','Λ','Θ','Ξ','Π','Γ'];
    const SIGILS_M=['α','β','γ','δ','ε','ζ','η','θ','ι','κ','λ','μ'];
    const RING_SPDS=[.0012,-.0008,.0015,-.002,.003];
    return{
      init(d){
        d._tick=0;d._rA=[0,0,0,0,0];d._rsparks=[];
        d.canvas.addEventListener('mouseenter',()=>{d._hover=true;});
        d.canvas.addEventListener('mouseleave',()=>{d._hover=false;});
        if(!d._castBound){d._castBound=e=>{const r=d.canvas.getBoundingClientRect();this.trigger(d,e.clientX-r.left,e.clientY-r.top);};d.canvas.addEventListener('click',d._castBound);}
      },
      trigger(d,x,y){d.tx=x;d.ty=y;},
      frame(d){
        d._tick++;
        const hover=d._hover||false;
        const cx0=d.tx!=null?d.tx:d.W/DPR*.5,cy0=d.ty!=null?d.ty:d.H/DPR*.5;
        if(d.burst>0.5){for(let i=0;i<12;i++){const a=rand(0,PI2);d._rsparks.push({x:cx0+Math.cos(a)*rand(10,80),y:cy0+Math.sin(a)*rand(10,80),vx:Math.cos(a)*rand(.5,2.5),vy:Math.sin(a)*rand(.5,2.5),age:0,max:rand(40,90),sz:rand(.8,2.5),isGreen:Math.random()<.62});}}
        const ctx=d.ctx;
        ctx.setTransform(DPR,0,0,DPR,0,0);
        const w=d.W/DPR,h=d.H/DPR,cx=(d.tx!=null?d.tx:w*.5),cy=(d.ty!=null?d.ty:h*.5),R=Math.min(w,h)*.47,tick=d._tick;
        if(d.bg===false){ctx.globalCompositeOperation="destination-out";ctx.fillStyle="rgba(0,0,0,0.20)";ctx.fillRect(0,0,w,h);ctx.globalCompositeOperation="source-over";}else{ctx.fillStyle='rgba(2,3,4,0.20)';ctx.fillRect(0,0,w,h);}
        ctx.save();ctx.globalCompositeOperation='screen';
        const amb=ctx.createRadialGradient(cx,cy,0,cx,cy,R*1.1);
        const aA=(hover?.022:.010)+Math.sin(tick*.03)*.005;
        amb.addColorStop(0,`rgba(40,255,110,${aA*2.2})`);amb.addColorStop(.45,`rgba(20,160,80,${aA*.8})`);amb.addColorStop(.75,`rgba(200,110,20,${aA*.4})`);amb.addColorStop(1,'rgba(0,0,0,0)');
        ctx.fillStyle=amb;ctx.fillRect(0,0,w,h);ctx.restore();
        ctx.save();ctx.globalCompositeOperation='screen';ctx.translate(cx,cy);
        const spd=.5+d.param*.8;
        [[.48,2.2],[.40,1.2],[.32,1.8],[.22,1.0],[.12,1.4]].forEach(([rf,lw],ri)=>{
          d._rA[ri]+=RING_SPDS[ri]*spd*(hover?2.8:1);
          const rad=R*rf,pulse=.55+Math.sin(tick*.04+ri*.9)*.3;
          const isG=ri%2===0;const[rr,rg,rb]=isG?[50,255,120]:[255,140,30];
          const rA=(hover?.7:.38)*pulse;
          ctx.shadowBlur=hover?16:7;ctx.shadowColor=`rgba(${rr},${rg},${rb},.8)`;
          ctx.strokeStyle=`rgba(${rr},${rg},${rb},${rA})`;ctx.lineWidth=lw;
          ctx.beginPath();ctx.arc(0,0,rad,0,PI2);ctx.stroke();ctx.shadowBlur=0;
          const tks=36;for(let i=0;i<tks;i++){const a=d._rA[ri]+(PI2/tks)*i,long=i%(tks/(ri+2))===0;ctx.strokeStyle=`rgba(${rr},${rg},${rb},${(hover?rA*.85:rA*.45)})`;ctx.lineWidth=long?1.5:.6;const r2=rad-(long?11:5);ctx.beginPath();ctx.moveTo(Math.cos(a)*rad,Math.sin(a)*rad);ctx.lineTo(Math.cos(a)*r2,Math.sin(a)*r2);ctx.stroke();}
        });
        const triR=R*.28,triA=tick*.003;
        ctx.save();ctx.rotate(triA);ctx.shadowBlur=hover?22:9;ctx.shadowColor='rgba(50,255,120,.9)';ctx.strokeStyle=`rgba(60,255,130,${hover?.85:.5})`;ctx.lineWidth=hover?2.2:1.4;ctx.beginPath();for(let i=0;i<3;i++){const a=(PI2/3)*i-Math.PI/2;i===0?ctx.moveTo(Math.cos(a)*triR,Math.sin(a)*triR):ctx.lineTo(Math.cos(a)*triR,Math.sin(a)*triR);}ctx.closePath();ctx.fillStyle=`rgba(30,180,80,${hover?.06:.02})`;ctx.fill();ctx.stroke();ctx.shadowBlur=0;ctx.restore();
        ctx.save();ctx.rotate(-triA*.7);ctx.shadowBlur=hover?16:6;ctx.shadowColor='rgba(255,140,30,.8)';ctx.strokeStyle=`rgba(255,150,40,${hover?.72:.35})`;ctx.lineWidth=hover?1.6:1;ctx.beginPath();for(let i=0;i<3;i++){const a=(PI2/3)*i+Math.PI/2;i===0?ctx.moveTo(Math.cos(a)*triR*.88,Math.sin(a)*triR*.88):ctx.lineTo(Math.cos(a)*triR*.88,Math.sin(a)*triR*.88);}ctx.closePath();ctx.stroke();ctx.shadowBlur=0;ctx.restore();
        ctx.save();ctx.rotate(d._rA[0]);ctx.font=`${Math.max(10,R*.075)}px serif`;ctx.textAlign='center';ctx.textBaseline='middle';
        SIGILS_O.forEach((s,i)=>{const a=(PI2/SIGILS_O.length)*i,sx=Math.cos(a)*R*.44,sy=Math.sin(a)*R*.44;const sa=hover?.82:.38,pulse=Math.sin(tick*.06+i*1.1)*.28+.72;ctx.shadowBlur=hover?12:4;ctx.shadowColor='rgba(50,255,120,.9)';ctx.fillStyle=`rgba(70,255,140,${sa*pulse})`;ctx.save();ctx.translate(sx,sy);ctx.rotate(-d._rA[0]-a+Math.PI*.5);ctx.fillText(s,0,0);ctx.restore();});
        ctx.shadowBlur=0;ctx.restore();
        ctx.save();ctx.rotate(d._rA[2]);ctx.font=`${Math.max(8,R*.055)}px serif`;
        SIGILS_M.forEach((s,i)=>{const a=(PI2/SIGILS_M.length)*i,sx=Math.cos(a)*R*.36,sy=Math.sin(a)*R*.36;const sa=hover?.72:.28,pulse=Math.sin(tick*.05+i*.8)*.3+.7;ctx.shadowBlur=hover?9:3;ctx.shadowColor='rgba(255,150,40,.9)';ctx.fillStyle=`rgba(255,160,50,${sa*pulse})`;ctx.save();ctx.translate(sx,sy);ctx.rotate(-d._rA[2]-a+Math.PI*.5);ctx.fillText(s,0,0);ctx.restore();});
        ctx.shadowBlur=0;ctx.restore();
        for(let i=0;i<8;i++){const a=d._rA[1]+(PI2/8)*i,isO=i%2===1;const[rr,rg,rb]=isO?[255,140,30]:[50,255,120];ctx.strokeStyle=`rgba(${rr},${rg},${rb},${(hover?.28:.10)+Math.sin(tick*.05+i)*.05})`;ctx.lineWidth=.7;ctx.beginPath();ctx.moveTo(Math.cos(a)*R*.12,Math.sin(a)*R*.12);ctx.lineTo(Math.cos(a)*R*.47,Math.sin(a)*R*.47);ctx.stroke();}
        const csz=R*.065+Math.sin(tick*.08)*R*.02;
        const cg=ctx.createRadialGradient(0,0,0,0,0,csz);
        cg.addColorStop(0,'rgba(255,255,255,.95)');cg.addColorStop(.25,'rgba(120,255,160,.75)');cg.addColorStop(1,'rgba(0,0,0,0)');
        ctx.shadowBlur=hover?32:16;ctx.shadowColor='#40ff90';ctx.fillStyle=cg;ctx.beginPath();ctx.arc(0,0,csz,0,PI2);ctx.fill();ctx.shadowBlur=0;
        ctx.restore();
        if(hover&&tick%3===0){const a=rand(0,PI2),sr=R*rand(.06,.48);d._rsparks.push({x:cx+Math.cos(a)*sr,y:cy+Math.sin(a)*sr,vx:Math.cos(a)*rand(.3,1.8),vy:Math.sin(a)*rand(.3,1.8),age:0,max:rand(40,90),sz:rand(.8,2.5),isGreen:Math.random()<.62});}
        if(tick%55===0){const a=rand(0,PI2);d._rsparks.push({x:cx+Math.cos(a)*R*rand(.15,.47),y:cy+Math.sin(a)*R*rand(.15,.47),vx:Math.cos(a)*rand(.3,1.5),vy:Math.sin(a)*rand(.3,1.5),age:0,max:rand(40,90),sz:rand(.8,2.5),isGreen:Math.random()<.62});}
        ctx.save();ctx.globalCompositeOperation='screen';
        /* [FIX] filter→인플레이스 역방향 splice */
        for(let _i=d._rsparks.length-1;_i>=0;_i--){if(d._rsparks[_i].age>=d._rsparks[_i].max)d._rsparks.splice(_i,1);}
        for(const sp of d._rsparks){sp.age++;sp.x+=sp.vx;sp.y+=sp.vy;sp.vx*=.97;sp.vy*=.97;const p=sp.age/sp.max,a=Math.sin(p*Math.PI)*.9,sz=Math.max(sp.sz*(1-p*.6),.3);ctx.fillStyle=sp.isGreen?`rgba(60,255,130,${a})`:`rgba(255,160,50,${a})`;ctx.beginPath();ctx.arc(sp.x,sp.y,sz,0,PI2);ctx.fill();}
        ctx.restore();
        ctx.setTransform(1,0,0,1,0,0);
      },
      hud(d){return'SIGIL · '+d.fps+'FPS';}
    };
  })();

  /* ===== FX29 AQUA BOMB — [v8] 비눗방울 전용 ===== */
  /* 비눗방울 생성 → 상승 → 충돌/분열 → 터짐(무지개 파편) */
  const FX29=(function(){
    // Draw a single soap bubble with iridescent film
    function drawBubble(ctx,x,y,r,alpha,hueShift){
      if(r<1)return;
      ctx.save();ctx.globalAlpha=alpha;
      // outer aura
      const ga=ctx.createRadialGradient(x,y,r*.3,x,y,r*1.6);
      ga.addColorStop(0,"rgba(180,230,255,.15)");ga.addColorStop(1,"transparent");
      ctx.fillStyle=ga;ctx.beginPath();ctx.arc(x,y,r*1.6,0,TAU);ctx.fill();
      // thin film body - very transparent
      ctx.fillStyle="rgba(180,235,255,.04)";
      ctx.beginPath();ctx.arc(x,y,r,0,TAU);ctx.fill();
      // iridescent ring (rainbow film)
      const hs=hueShift||0;
      const gl=ctx.createLinearGradient(x-r,y-r,x+r,y+r);
      gl.addColorStop(0,"hsla("+(hs%360)+",100%,75%,.55)");
      gl.addColorStop(.25,"hsla("+((hs+80)%360)+",100%,78%,.48)");
      gl.addColorStop(.5,"hsla("+((hs+160)%360)+",100%,80%,.52)");
      gl.addColorStop(.75,"hsla("+((hs+240)%360)+",100%,76%,.46)");
      gl.addColorStop(1,"hsla("+(hs%360)+",100%,74%,.55)");
      ctx.strokeStyle=gl;ctx.lineWidth=Math.max(1.2,r*.055);
      ctx.shadowBlur=Math.min(18,r*.8);ctx.shadowColor="rgba(160,220,255,.6)";
      ctx.beginPath();ctx.arc(x,y,r,0,TAU);ctx.stroke();
      ctx.shadowBlur=0;
      // specular highlight
      ctx.fillStyle="rgba(255,255,255,.55)";
      ctx.beginPath();ctx.ellipse(x-r*.3,y-r*.32,r*.18,r*.11,-Math.PI/4,0,TAU);ctx.fill();
      // secondary soft highlight
      ctx.fillStyle="rgba(200,240,255,.2)";
      ctx.beginPath();ctx.ellipse(x+r*.22,y+r*.28,r*.09,r*.06,Math.PI/3,0,TAU);ctx.fill();
      // inner glow ring
      ctx.strokeStyle="rgba(200,240,255,.10)";ctx.lineWidth=1;
      ctx.beginPath();ctx.arc(x,y,r*.75,0,TAU);ctx.stroke();
      ctx.restore();
    }

    return{
      init(d){
        d._at=0;
        d._bubbles=[];   // floating bubbles
        d._pops=[];      // pop sparkle events
        d._wand=0;       // wand blow phase
        d._wandT=0;      // wand timer
        if(!d._castBound){d._castBound=e=>{const r=d.canvas.getBoundingClientRect();this.trigger(d,e.clientX-r.left,e.clientY-r.top);};d.canvas.addEventListener('click',d._castBound);}
      },
      trigger(d,x,y){d.tx=x;d.ty=y;},
      frame(d){
        const c=d.ctx,W=d.W,H=d.H;
        c.setTransform(DPR,0,0,DPR,0,0);
        const w=W/DPR,h=H/DPR,cx=w/2;
        const wandX=(d.tx!=null?d.tx:cx),wandY=(d.ty!=null?d.ty:h*.88);
        d._at++;
        const t=d._at;

        c.clearRect(0,0,w,h);

        // soft gradient background
        if(d.bg!==false){
        const bgG=c.createRadialGradient(cx,h*.5,0,cx,h*.5,Math.max(w,h)*.7);
        bgG.addColorStop(0,"rgba(220,240,255,.18)");bgG.addColorStop(1,"rgba(160,200,240,.06)");
        c.fillStyle=bgG;c.fillRect(0,0,w,h);}

        // burst → immediate multi-bubble spawn
        if(d.burst>0.5){
          for(let i=0;i<8;i++){
            const bx=wandX+(Math.random()-.5)*60,by=wandY-20;
            d._bubbles.push({
              x:bx,y:by,r:12+Math.random()*22,
              vx:(Math.random()-.5)*1.2,vy:-(0.6+Math.random()*2),
              wobble:Math.random()*TAU,wspd:.03+Math.random()*.04,
              life:1,dec:.0018+Math.random()*.002,
              hue:Math.floor(Math.random()*360),born:t,
              maxR:12+Math.random()*22
            });
          }
        }

        // auto wand blow
        d._wandT++;
        if(d._wandT>80){
          d._wandT=0;
          const cnt=1+Math.floor(Math.random()*3);
          for(let i=0;i<cnt&&d._bubbles.length<35;i++){
            const spread=(Math.random()-.5)*30;
            const sz=10+Math.random()*28;
            d._bubbles.push({
              x:wandX+spread,y:wandY-14,r:sz*.15,
              vx:(Math.random()-.5)*.7,vy:-(0.3+Math.random()*1.5),
              wobble:Math.random()*TAU,wspd:.025+Math.random()*.04,
              life:1,dec:.0015+Math.random()*.0018,
              hue:Math.floor(Math.random()*360),born:t,
              maxR:sz,growRate:.8+Math.random()*.5
            });
          }
        }

        // soap portal ring (no wand stick)
        c.save();
        const filmA=0.10+0.09*Math.sin(t*.08);
        const pRad=12+4*Math.sin(t*.12);
        // iridescent ring
        const pRingG=c.createLinearGradient(wandX-pRad,wandY-pRad,wandX+pRad,wandY+pRad);
        pRingG.addColorStop(0,"hsla("+(t*2%360)+",100%,75%,.7)");
        pRingG.addColorStop(.5,"hsla("+((t*2+120)%360)+",100%,78%,.6)");
        pRingG.addColorStop(1,"hsla("+((t*2+240)%360)+",100%,75%,.7)");
        c.strokeStyle=pRingG;c.lineWidth=2.5;c.shadowBlur=12;c.shadowColor="rgba(160,220,255,.6)";
        c.beginPath();c.arc(wandX,wandY,pRad,0,TAU);c.stroke();
        // film inside ring
        const filmG=c.createLinearGradient(wandX-pRad,wandY-pRad,wandX+pRad,wandY+pRad);
        filmG.addColorStop(0,"hsla("+(t*3%360)+",100%,80%,"+filmA+")");
        filmG.addColorStop(1,"hsla("+((t*3+180)%360)+",100%,80%,"+filmA+")");
        c.fillStyle=filmG;c.beginPath();c.arc(wandX,wandY,pRad-1,0,TAU);c.fill();
        c.shadowBlur=0;c.restore();

        // update & draw bubbles
        for(let i=d._bubbles.length-1;i>=0;i--){
          const b=d._bubbles[i];
          // grow phase
          if(b.r<b.maxR){b.r=Math.min(b.maxR,b.r+(b.growRate||1)*.5);}
          b.x+=b.vx;b.y+=b.vy;
          b.wobble+=b.wspd;
          b.vx+=Math.sin(b.wobble)*.018;
          b.vy*=.995;
          b.vy-=.005; // gentle upward drift
          b.hue=(b.hue+.4)%360;
          b.life-=b.dec;

          // random pop
          const popRand=b.r>20?0.0008:0.0003;
          if(b.life<=0||b.y<-b.r||Math.random()<popRand){
            // spawn pop event
            d._pops.push({x:b.x,y:b.y,r:b.r,hue:b.hue,life:1,t:0});
            d._bubbles.splice(i,1);continue;
          }

          // check collision with other bubbles (merge small ones)
          for(let j=i-1;j>=0;j--){
            const b2=d._bubbles[j];
            const dx=b.x-b2.x,dy=b.y-b2.y;
            const dist=Math.sqrt(dx*dx+dy*dy);
            if(dist<(b.r+b2.r)*.9){
              // bounce apart gently
              const nx=dx/(dist||1),ny=dy/(dist||1);
              b.vx+=nx*.3;b.vy+=ny*.3;
              b2.vx-=nx*.3;b2.vy-=ny*.3;
            }
          }

          const wx=b.x+Math.sin(b.wobble+b.x*.01)*b.r*.04;
          drawBubble(c,wx,b.y,b.r,Math.min(1,b.life),b.hue);
        }

        // pop sparkle effects
        c.save();c.globalCompositeOperation="screen";
        for(let i=d._pops.length-1;i>=0;i--){
          const p=d._pops[i];p.t++;p.life-=.06;
          if(p.life<=0){d._pops.splice(i,1);continue;}
          const nSparks=10;
          for(let k=0;k<nSparks;k++){
            const a=(k/nSparks)*TAU,spd=p.r*.12*(1-p.life*.5);
            const sx=p.x+Math.cos(a)*spd*p.t,sy=p.y+Math.sin(a)*spd*p.t;
            const sr=Math.max(.3,(p.r*.06)*p.life);
            const hk=(p.hue+k*30)%360;
            c.fillStyle="hsla("+hk+",100%,80%,"+p.life*.8+")";
            c.beginPath();c.arc(sx,sy,sr,0,TAU);c.fill();
          }
          // pop ring
          c.strokeStyle="hsla("+p.hue+",100%,82%,"+(p.life*.5)+")";
          c.lineWidth=1.5;c.beginPath();c.arc(p.x,p.y,p.r+p.t*2,0,TAU);c.stroke();
        }
        c.restore();

        // cycle reset
        if(d._at>600&&d._bubbles.length===0&&d._pops.length===0){d._at=0;}
        c.setTransform(1,0,0,1,0,0);
      },
      hud(d){return"SOAP BUBBLES · "+d.fps+"FPS";}
    };
  })();
  /* ---- wire ---- */

  /* ===== FX30 LIQUID TERRAIN — [v8.3] 성능최적화 + 높이조정 ===== */
  const FX30=(function(){
    const C=48, R=48;  // 48×48: perf sweet-spot
    const IDX=(i,j)=>j*C+i;
    const _clamp=(v,a,b)=>v<a?a:v>b?b:v;
    const _lerp=(a,b,t)=>a+(b-a)*t;
    return{
      init(d){
        d._h=new Float32Array(C*R);
        d._v=new Float32Array(C*R);
        d._clicks=[];d._pt=0;
        d._h[IDX(C>>1,R>>1)]=2.5;
        if(!d._ltClick){
          d._ltClick=(e)=>{
            const rect=d.canvas.getBoundingClientRect();
            const W2=d.W,H2=d.H;
            const mx=(e.clientX-rect.left)*(W2/rect.width);
            const my=(e.clientY-rect.top)*(H2/rect.height);
            const cw=(W2*.88)/(C+R-2),ch=cw*.5;
            const ox=W2/2,oy=H2*.56;
            const rx=mx-ox,ry=my-oy;
            const gi=_clamp(0|((rx/cw+ry/ch)/2)+(C/2|0)-1,1,C-2);
            const gj=_clamp(0|((ry/ch-rx/cw)/2)+(R/2|0)-1,1,R-2);
            d._h[IDX(gi,gj)]=3.5;
            d._clicks.push({gi,gj,r:0,age:0});
          };
          d.canvas.addEventListener('click',d._ltClick);
        }
      },
      frame(d,dt){
        const c=d.ctx,W2=d.W,H2=d.H;
        const hS=18;  // wave height — comfortable, not spiky
        const K=.26,D=.993;

        d._pt+=dt*.016;
        if(d._pt>=1){
          d._pt=0;
          const pi=4+Math.floor(Math.random()*(C-8));
          const pj=4+Math.floor(Math.random()*(R-8));
          d._h[IDX(pi,pj)]=1.4+Math.random()*1.6;
        }
        const ci=C>>1,cj=R>>1;
        d._h[IDX(ci,cj)]+=Math.sin(d.t*3)*0.038;

        for(let ci2=d._clicks.length-1;ci2>=0;ci2--){
          const ck=d._clicks[ci2];ck.age+=dt*.016;ck.r+=dt*.28;
          if(ck.age>1.5){d._clicks.splice(ci2,1);continue;}
          const amp=(1-ck.age/1.5)*1.6;
          for(let j=1;j<R-1;j++) for(let i=1;i<C-1;i++){
            const dx=i-ck.gi,dy=j-ck.gj,dist=Math.sqrt(dx*dx+dy*dy),diff=Math.abs(dist-ck.r);
            if(diff<1.4) d._h[IDX(i,j)]+=amp*Math.max(0,1-diff);
          }
        }
        if(d.burst>.5){
          for(let b=0;b<4;b++){
            const pi=4+Math.floor(Math.random()*(C-8));
            const pj=4+Math.floor(Math.random()*(R-8));
            d._h[IDX(pi,pj)]=4.0;
            d._clicks.push({gi:pi,gj:pj,r:0,age:0});
          }
        }

        const h=d._h,v=d._v;
        for(let j=1;j<R-1;j++) for(let i=1;i<C-1;i++){
          const ii=j*C+i;
          const nb=(h[ii-1]+h[ii+1]+h[(j-1)*C+i]+h[(j+1)*C+i])*.25;
          v[ii]=(v[ii]+K*(nb-h[ii]))*D;
        }
        for(let k=0;k<C*R;k++) h[k]+=v[k];

        c.fillStyle='#01040c';c.fillRect(0,0,W2,H2);
        const cw=(W2*.88)/(C+R-2),ch=cw*.5;
        const ox=W2/2,oy=H2*.56;
        const maxS=(C-2)+(R-2);
        for(let s=0;s<=maxS;s++){
          const i0=Math.max(1,s-(R-2)),i1=Math.min(C-2,s);
          for(let i=i0;i<=i1;i++){
            const j=s-i;if(j<1||j>R-2)continue;
            const h00=h[IDX(i,j)],h10=h[IDX(i+1,j)],h01=h[IDX(i,j+1)],h11=h[IDX(i+1,j+1)];
            const avg=(h00+h10+h01+h11)*.25;
            const sx00=(i-j)*cw*.5+ox,   sy00=(i+j)*ch*.5+oy-h00*hS;
            const sx10=(i+1-j)*cw*.5+ox, sy10=(i+j)*ch*.5+oy-h10*hS;
            const sx11=(i+1-j)*cw*.5+ox, sy11=(i+j+1)*ch*.5+oy-h11*hS;
            const sx01=(i-j)*cw*.5+ox,   sy01=(i+j+1)*ch*.5+oy-h01*hS;
            if(Math.max(sx00,sx10,sx11,sx01)<-4)continue;
            if(Math.min(sx00,sx10,sx11,sx01)>W2+4)continue;
            if(Math.max(sy00,sy10,sy11,sy01)<-4)continue;
            if(Math.min(sy00,sy10,sy11,sy01)>H2+4)continue;
            const hn=_clamp((avg+.5)*.55,0,1),hn2=hn*hn;
            const rv=4+hn2*200,gv=12+hn2*228,bv=28+hn*225;
            c.globalAlpha=_lerp(.05,.92,hn);
            c.fillStyle=`rgb(${0|rv},${0|gv},${0|bv})`;
            if(hn>.68){c.shadowColor=`rgba(180,225,255,${(hn-.5)*.7})`;c.shadowBlur=14;}
            else c.shadowBlur=0;
            c.beginPath();
            c.moveTo(sx00,sy00);c.lineTo(sx10,sy10);c.lineTo(sx11,sy11);c.lineTo(sx01,sy01);
            c.closePath();c.fill();
            if(hn>.2){
              c.shadowBlur=0;c.globalAlpha=hn*.3;
              c.strokeStyle=`rgba(${0|rv},${0|gv},${0|bv},.65)`;
              c.lineWidth=.4;c.stroke();
            }
            if(hn>.12&&sy00!==sy01){
              c.globalAlpha=_lerp(.04,.88,hn)*.42;
              c.fillStyle=`rgb(${0|rv*.5},${0|gv*.5},${0|bv*.58})`;
              c.shadowBlur=0;
              c.beginPath();
              c.moveTo(sx01,sy01);c.lineTo(sx01,sy01+ch*.72);
              c.lineTo(sx00,sy00+ch*.72);c.lineTo(sx00,sy00);
              c.closePath();c.fill();
            }
          }
        }
        c.shadowBlur=0;c.globalAlpha=1;
        const bg=c.createRadialGradient(W2*.5,H2*.62,0,W2*.5,H2*.62,W2*.45);
        bg.addColorStop(0,'rgba(140,200,255,.035)');bg.addColorStop(1,'transparent');
        c.fillStyle=bg;c.fillRect(0,0,W2,H2);
      },
      hud(d){return'LIQUID TERRAIN · '+d.fps+'FPS';}
    };
  })();

  
/* ─── INT SCENE CLASSES ──────────────────────────────── */
class QuantumOverride{
  constructor(c){this.c=c;this.ctx=c.getContext('2d');this.W=c.width;this.H=c.height;this.t=0;
    this.mx=c.width*.5;this.my=c.height*.5;this.repel=50;
    this.N=5000;this.px=new Float32Array(this.N);this.py=new Float32Array(this.N);
    this.pvx=new Float32Array(this.N);this.pvy=new Float32Array(this.N);
    this.pa=new Float32Array(this.N);this.ps=new Float32Array(this.N);this.pt=new Uint8Array(this.N);
    this.gtx=new Float32Array(this.N);this.gty=new Float32Array(this.N);
    this.grid=[];this.glitch=0;this.gn=2;
    this._bg();this._ip();
    this._mm=e=>{const r=this.c.getBoundingClientRect();this.mx=e.clientX-r.left;this.my=e.clientY-r.top;};
    c.addEventListener('mousemove',this._mm);}
  action(){/* force grid snap for 2s */this.forceSnap=2;}
  _bg(){const cx=this.W*.5,cy=this.H*.5;this.grid.length=0;const step=Math.max(20,Math.floor(Math.min(this.W,this.H)/18));
    for(let x=0;x<this.W;x+=step)for(let y=0;y<this.H;y+=step)this.grid.push({x,y});
    const maxR=Math.min(this.W,this.H)*.45;
    [.15,.28,.42,.56,.7,.85].forEach((f,ri)=>{const r=maxR*f,n=Math.round(8+ri*6);for(let i=0;i<n;i++){const a=i/n*Math.PI*2;this.grid.push({x:cx+Math.cos(a)*r,y:cy+Math.sin(a)*r});}});}
  _ip(){const cx=this.W*.5,cy=this.H*.5,GL=this.grid.length;
    for(let i=0;i<this.N;i++){const a=Math.random()*Math.PI*2,r=10+Math.random()*Math.max(this.W,this.H)*.6;
      this.px[i]=cx+Math.cos(a)*r;this.py[i]=cy+Math.sin(a)*r;
      this.pvx[i]=(Math.random()-.5)*40;this.pvy[i]=(Math.random()-.5)*40;
      this.pa[i]=.3+Math.random()*.7;this.ps[i]=.5+Math.random()*1.8;this.pt[i]=i%3;
      const gi=i%GL;this.gtx[i]=this.grid[gi].x;this.gty[i]=this.grid[gi].y;}}
  resize(w,h){this.W=w;this.H=h;this._bg();const GL=this.grid.length;for(let i=0;i<this.N;i++){const gi=i%GL;this.gtx[i]=this.grid[gi].x;this.gty[i]=this.grid[gi].y;}}
  update(dt){this.t+=dt;this.gn-=dt;if(this.gn<=0){this.glitch=1;this.gn=1.5+Math.random()*3;}this.glitch*=.88;
    if(this.forceSnap>0)this.forceSnap-=dt;
    const cx=this.W*.5,cy=this.H*.5,sn=Math.sin(this.t*.25)>.4||(this.forceSnap>0);
    const rStr=(this.repel/50)*900;const rRad=100+this.repel;
    for(let i=0;i<this.N;i++){let vx=this.pvx[i],vy=this.pvy[i],px=this.px[i],py=this.py[i];
      const rdx=px-this.mx,rdy=py-this.my,rd2=rdx*rdx+rdy*rdy,rr2=rRad*rRad;
      if(rd2<rr2){const rd=Math.sqrt(rd2)+.001,f=(rRad-rd)/rRad*rStr;vx+=rdx/rd*f*dt;vy+=rdy/rd*f*dt;}
      if(sn){vx+=(this.gtx[i]-px)*280*dt;vy+=(this.gty[i]-py)*280*dt;vx*=.82;vy*=.82;}
      else{const dx=cx-px,dy=cy-py,d=Math.sqrt(dx*dx+dy*dy)+.001;vx+=dx/d*18*dt;vy+=dy/d*18*dt;vx-=dy/d*6*dt;vy+=dx/d*6*dt;vx*=.988;vy*=.988;}
      px+=vx*dt;py+=vy*dt;
      if(px<-40)px=this.W+35;else if(px>this.W+40)px=-35;if(py<-40)py=this.H+35;else if(py>this.H+40)py=-35;
      this.px[i]=px;this.py[i]=py;this.pvx[i]=vx;this.pvy[i]=vy;}}
  render(){const ctx=this.ctx,W=this.W,H=this.H,cx=W*.5,cy=H*.5;
    ctx.globalAlpha=.14;ctx.fillStyle='#000';ctx.fillRect(0,0,W,H);ctx.globalAlpha=1;
    const pr=Math.min(W,H)*.035+Math.sin(this.t*9)*Math.min(W,H)*.006;
    const g2=ctx.createRadialGradient(cx,cy,0,cx,cy,pr*5);g2.addColorStop(0,'rgba(0,255,255,.25)');g2.addColorStop(.3,'rgba(255,0,255,.1)');g2.addColorStop(1,'transparent');ctx.fillStyle=g2;ctx.fillRect(0,0,W,H);
    ctx.save();ctx.strokeStyle='rgba(0,255,255,.9)';ctx.lineWidth=1.5;ctx.shadowBlur=16;ctx.shadowColor='#00ffff';ctx.beginPath();ctx.arc(cx,cy,pr,0,Math.PI*2);ctx.stroke();ctx.strokeStyle='rgba(255,0,255,.5)';ctx.shadowColor='#ff00ff';ctx.beginPath();ctx.arc(cx,cy,pr*.6,0,Math.PI*2);ctx.stroke();ctx.restore();
    if(Math.sin(this.t*.25)>.4||(this.forceSnap>0)){const step=Math.max(20,Math.floor(Math.min(W,H)/18));ctx.globalAlpha=.05;ctx.strokeStyle='#00ffff';ctx.lineWidth=.5;ctx.beginPath();for(let gx=0;gx<W;gx+=step){ctx.moveTo(gx,0);ctx.lineTo(gx,H);}for(let gy=0;gy<H;gy+=step){ctx.moveTo(0,gy);ctx.lineTo(W,gy);}ctx.stroke();ctx.globalAlpha=1;}
    const C=['#00ffff','#ff00ff','#ffffff'];
    for(let i=0;i<this.N;i++){ctx.globalAlpha=this.pa[i];ctx.fillStyle=C[this.pt[i]];const s=this.ps[i];ctx.fillRect(this.px[i]-s*.5,this.py[i]-s*.5,s,s);}
    if(this.glitch>.06){const gl=this.glitch;for(let k=0;k<5;k++){ctx.globalAlpha=gl*(.1+Math.random()*.1);ctx.fillStyle=['#00ffff','#ff00ff','#fff'][k%3];ctx.fillRect(Math.random()*W,Math.random()*H,Math.random()*W*.4,Math.random()*2+.5);}ctx.globalAlpha=gl*.06;ctx.globalCompositeOperation='screen';ctx.drawImage(this.c,Math.floor(gl*10)-5,0);ctx.globalCompositeOperation='source-over';}ctx.shadowBlur=0;ctx.globalAlpha=1;}
  destroy(){this.c.removeEventListener('mousemove',this._mm);}}
class AbyssalResonance{
  constructor(c){this.c=c;this.ctx=c.getContext('2d');this.W=c.width;this.H=c.height;this.t=0;this.flowSpeed=100;
    this.N=2800;this.px=new Float32Array(this.N);this.py=new Float32Array(this.N);this.pvx=new Float32Array(this.N);this.pvy=new Float32Array(this.N);this.pt=new Uint8Array(this.N);this.ps=new Float32Array(this.N);
    for(let i=0;i<this.N;i++){this.px[i]=Math.random()*this.W;this.py[i]=Math.random()*this.H;this.pt[i]=i%3;this.ps[i]=1+Math.random()*1.5;}
    this.wells=[];this._onmd=e=>{const r=this.c.getBoundingClientRect();this.wells.push({x:e.clientX-r.left,y:e.clientY-r.top,s:1});if(this.wells.length>6)this.wells.shift();};c.addEventListener('mousedown',this._onmd);}
  action(){const r=this.c.getBoundingClientRect();this.wells.push({x:this.W*.5,y:this.H*.5,s:1.5});if(this.wells.length>6)this.wells.shift();}
  _fa(x,y,t){const s=.0028;return(Math.sin(x*s*2.1+t*.35)+Math.cos(y*s*1.7-t*.28))*Math.PI;}
  resize(w,h){this.W=w;this.H=h;}
  update(dt){this.t+=dt*(this.flowSpeed/100)*.35;for(let i=this.wells.length-1;i>=0;i--){this.wells[i].s-=dt*1.2;if(this.wells[i].s<=0)this.wells.splice(i,1);}
    for(let i=0;i<this.N;i++){let x=this.px[i],y=this.py[i],vx=this.pvx[i],vy=this.pvy[i];const a=this._fa(x,y,this.t),sp=Math.max(2,20*(this.flowSpeed/100)+Math.sin(x*.007+this.t)*12);vx+=Math.cos(a)*sp*dt;vy+=Math.sin(a)*sp*dt;for(const w of this.wells){const dx=w.x-x,dy=w.y-y,d=Math.hypot(dx,dy);if(d<8)continue;const df=d+.001,f=w.s*220/df;vx+=dx/df*f*dt;vy+=dy/df*f*dt;}const spd=Math.hypot(vx,vy);if(spd>60){vx*=60/spd;vy*=60/spd;}vx*=Math.pow(.94,dt*60);vy*=Math.pow(.94,dt*60);x+=vx*dt;y+=vy*dt;if(x<0)x+=this.W;else if(x>this.W)x-=this.W;if(y<0)y+=this.H;else if(y>this.H)y-=this.H;this.px[i]=x;this.py[i]=y;this.pvx[i]=vx;this.pvy[i]=vy;}}
  render(){const ctx=this.ctx,W=this.W,H=this.H;ctx.globalAlpha=.055;ctx.fillStyle='#000';ctx.fillRect(0,0,W,H);ctx.globalAlpha=1;ctx.globalCompositeOperation='screen';const C=['rgba(110,0,200,','rgba(160,0,40,','rgba(130,0,110,'];for(let i=0;i<this.N;i++){const s=this.ps[i];ctx.fillStyle=C[this.pt[i]]+(0.35+((i*1234567)&255)/1280)+')';ctx.fillRect(this.px[i]-s*.5,this.py[i]-s*.5,s,s);}ctx.globalCompositeOperation='source-over';for(const w of this.wells){const rg=ctx.createRadialGradient(w.x,w.y,0,w.x,w.y,100*w.s);rg.addColorStop(0,'rgba(180,50,255,'+w.s*.3+')');rg.addColorStop(1,'transparent');ctx.fillStyle=rg;ctx.fillRect(0,0,W,H);}ctx.globalAlpha=1;}
  destroy(){this.c.removeEventListener('mousedown',this._onmd);}}
class SupernovaRemnant{
  constructor(c){this.c=c;this.ctx=c.getContext('2d');this.W=c.width;this.H=c.height;this.t=0;
    this.burstStrength=100;this.rings=[];this.ringTimer=0;
    this.N=2200;
    this.px=new Float32Array(this.N);this.py=new Float32Array(this.N);
    this.pvx=new Float32Array(this.N);this.pvy=new Float32Array(this.N);
    this.pl=new Float32Array(this.N);this.pm=new Float32Array(this.N);
    this.msx=c.width*.5;this.msy=c.height*.5;
    this._burst(this.W*.5,this.H*.5);this._ring(this.W*.5,this.H*.5);
    this._mm=e=>{const r=this.c.getBoundingClientRect();this.msx=e.clientX-r.left;this.msy=e.clientY-r.top;};
    this._mc=e=>{const r=this.c.getBoundingClientRect();const bx=e.clientX-r.left,by=e.clientY-r.top;
      this._ring(bx,by);this._miniBlast(bx,by);};
    c.addEventListener('mousemove',this._mm);c.addEventListener('click',this._mc);}
  action(){this._burst(this.W*.5,this.H*.5);this._ring(this.W*.5,this.H*.5);}
  _ring(ox,oy){if(this.rings.length>=20)this.rings.shift();this.rings.push({ox,oy,r:0,maxR:Math.max(this.W,this.H)*.88,spd:80+Math.random()*45,life:1,amp:5+Math.random()*11,freq:6+Math.floor(Math.random()*7),ph:Math.random()*Math.PI*2});}
  _burst(cx,cy){const str=this.burstStrength/100;
    for(let i=0;i<this.N;i++){const a=Math.random()*Math.PI*2,sp=(40+Math.random()*460)*str;
      this.px[i]=cx+(Math.random()-.5)*16;this.py[i]=cy+(Math.random()-.5)*16;
      this.pvx[i]=Math.cos(a)*sp;this.pvy[i]=Math.sin(a)*sp;
      this.pl[i]=Math.random()*2;this.pm[i]=2.5+Math.random()*5;}}
  _miniBlast(bx,by){const count=Math.floor(this.N*.14);const str=this.burstStrength/100;
    for(let k=0;k<count;k++){const i=Math.floor(Math.random()*this.N)%this.N;
      const a=Math.random()*Math.PI*2,sp=(30+Math.random()*200)*str;
      this.px[i]=bx+(Math.random()-.5)*10;this.py[i]=by+(Math.random()-.5)*10;
      this.pvx[i]=Math.cos(a)*sp;this.pvy[i]=Math.sin(a)*sp;this.pl[i]=0;this.pm[i]=1.5+Math.random()*3;}}
  resize(w,h){this.W=w;this.H=h;}
  update(dt){this.t+=dt;this.ringTimer-=dt;if(this.ringTimer<=0){this._ring(this.W*.5,this.H*.5);this.ringTimer=2+Math.random()*2.5;}
    for(let i=this.rings.length-1;i>=0;i--){const rg=this.rings[i];rg.r+=rg.spd*dt;rg.life=1-rg.r/rg.maxR;if(rg.life<=0)this.rings.splice(i,1);}
    const lensR=190,lensStr=55*(this.burstStrength/100);
    for(let i=0;i<this.N;i++){this.pl[i]+=dt;
      if(this.pl[i]>this.pm[i]){const a=Math.random()*Math.PI*2,sp=(40+Math.random()*460)*(this.burstStrength/100);
        this.px[i]=this.W*.5+(Math.random()-.5)*16;this.py[i]=this.H*.5+(Math.random()-.5)*16;
        this.pvx[i]=Math.cos(a)*sp;this.pvy[i]=Math.sin(a)*sp;this.pl[i]=0;this.pm[i]=2.5+Math.random()*5;continue;}
      const p=this.pl[i]/this.pm[i],fr=p<.22?Math.pow(.52,dt*60):Math.pow(.991,dt*60);
      /* Gravitational lens: gentle attraction toward mouse cursor */
      const glx=this.msx-this.px[i],gly=this.msy-this.py[i],gld=Math.hypot(glx,gly);
      if(gld<lensR&&gld>12){const f=lensStr*(1-gld/lensR)/gld;this.pvx[i]+=glx*f*dt;this.pvy[i]+=gly*f*dt;}
      this.pvx[i]*=fr;this.pvy[i]*=fr;this.px[i]+=this.pvx[i]*dt;this.py[i]+=this.pvy[i]*dt;}}
  render(){const ctx=this.ctx,W=this.W,H=this.H;
    ctx.globalAlpha=.16;ctx.fillStyle='#000';ctx.fillRect(0,0,W,H);ctx.globalAlpha=1;
    /* Lens halo around cursor */
    const lh=ctx.createRadialGradient(this.msx,this.msy,0,this.msx,this.msy,130);
    lh.addColorStop(0,'rgba(255,200,80,.05)');lh.addColorStop(1,'transparent');
    ctx.fillStyle=lh;ctx.fillRect(0,0,W,H);
    /* Shockwave rings — gravitationally warped near cursor */
    for(const rg of this.rings){ctx.save();ctx.globalAlpha=rg.life*.65;
      ctx.strokeStyle=`rgb(255,${Math.floor(160+rg.life*95)},0)`;
      ctx.lineWidth=1.2+rg.life*2.5;ctx.shadowBlur=10+rg.life*12;ctx.shadowColor='#ffaa00';
      ctx.beginPath();const seg=120;
      for(let s=0;s<=seg;s++){const a=s/seg*Math.PI*2;
        const rpx=rg.ox+Math.cos(a)*rg.r,rpy=rg.oy+Math.sin(a)*rg.r;
        const md=Math.hypot(rpx-this.msx,rpy-this.msy);
        /* Gravitational lensing: ring pushes away from cursor */
        const warp=md<140?(1-md/140)*22:0;
        const wdx=rpx-this.msx,wdy=rpy-this.msy,wd=Math.hypot(wdx,wdy)+.001;
        const disp=Math.sin(a*rg.freq+this.t*2.8+rg.ph)*rg.amp*rg.life;
        const rx=rg.ox+Math.cos(a)*(rg.r+disp)+wdx/wd*warp;
        const ry=rg.oy+Math.sin(a)*(rg.r+disp)+wdy/wd*warp;
        s===0?ctx.moveTo(rx,ry):ctx.lineTo(rx,ry);}
      ctx.closePath();ctx.stroke();ctx.restore();}
    /* Particles as velocity-direction filament streaks */
    ctx.save();ctx.globalCompositeOperation='screen';ctx.lineCap='round';
    for(let i=0;i<this.N;i++){const p=this.pl[i]/this.pm[i];const spd=Math.hypot(this.pvx[i],this.pvy[i]);
      let R,G,B,a;
      if(p<.12){R=255;G=255;B=240;a=.95-p*4;}
      else if(p<.3){const t=(p-.12)/.18;R=255;G=Math.floor(255-t*85);B=0;a=.75-t*.1;}
      else if(p<.55){const t=(p-.3)/.25;R=255;G=Math.floor(170-t*90);B=0;a=.65-t*.18;}
      else{const t=(p-.55)/.45;R=Math.floor(255-t*130);G=Math.floor(80-t*50);B=Math.floor(t*55);a=.47-t*.42;}
      if(a<=0.01)continue;ctx.globalAlpha=a;
      const tl=Math.min(spd*.045,14);
      if(tl>0.8&&spd>1){const nx=this.pvx[i]/spd,ny=this.pvy[i]/spd;
        ctx.strokeStyle=`rgb(${R},${G},${B})`;ctx.lineWidth=Math.max(.4,1.4-p*.8);
        ctx.shadowBlur=p<.28?5:0;ctx.shadowColor=`rgb(${R},${G},${B})`;
        ctx.beginPath();ctx.moveTo(this.px[i],this.py[i]);ctx.lineTo(this.px[i]-nx*tl,this.py[i]-ny*tl);ctx.stroke();
      }else{ctx.fillStyle=`rgb(${R},${G},${B})`;ctx.fillRect(this.px[i]-.5,this.py[i]-.5,1,1);}}
    ctx.restore();ctx.globalAlpha=1;ctx.shadowBlur=0;}
  destroy(){this.c.removeEventListener('mousemove',this._mm);this.c.removeEventListener('click',this._mc);}}
class EtherealPhalanx{
  constructor(c){this.c=c;this.ctx=c.getContext('2d');this.W=c.width;this.H=c.height;this.t=0;this.rotSpeed=100;
    /* Ring definitions: fraction of sc, harmonic freq, angular velocity, phase, color, linewidth, segment count */
    this.RD=[
      {f:.09,freq:9,angV: 2.4,ph:0,           col:'#00ffaa',w:2.1,segs:16},
      {f:.18,freq:8,angV:-2.0,ph:Math.PI*.22,  col:'#22ff88',w:1.9,segs:14},
      {f:.27,freq:7,angV: 1.7,ph:Math.PI*.44,  col:'#44ee77',w:1.7,segs:12},
      {f:.36,freq:6,angV:-1.4,ph:Math.PI*.66,  col:'#66dd55',w:1.5,segs:12},
      {f:.45,freq:5,angV: 1.1,ph:Math.PI*.88,  col:'#88cc44',w:1.3,segs:10},
      {f:.55,freq:4,angV:-.85,ph:Math.PI*1.1,  col:'#aabb33',w:1.1,segs:10},
      {f:.65,freq:3,angV: .62,ph:Math.PI*1.32, col:'#ccaa22',w:1.0,segs:8},
      {f:.76,freq:2,angV:-.42,ph:Math.PI*1.55, col:'#ddaa22',w:.9, segs:8},
      {f:.87,freq:1,angV: .26,ph:Math.PI*1.8,  col:'#eeaa22',w:.8, segs:6},
    ];
    this.rings=this.RD.map(d=>({...d,rot:0,r:0}));
    /* Convergence state */
    this.convF=1;this.convPh=0;this.isConv=false;this.convCD=5+Math.random()*4;
    this.hmx=c.width*.5;this.hmy=c.height*.5;
    this._mm=e=>{const r=this.c.getBoundingClientRect();this.hmx=e.clientX-r.left;this.hmy=e.clientY-r.top;};
    c.addEventListener('mousemove',this._mm);}
  action(){if(!this.isConv){this.isConv=true;this.convPh=0;}}
  resize(w,h){this.W=w;this.H=h;}
  update(dt){this.t+=dt*(this.rotSpeed/100);
    const sc=Math.min(this.W,this.H)*.47;
    const cx=this.W*.5,cy=this.H*.5;
    /* Auto-convergence countdown */
    if(!this.isConv){this.convCD-=dt;if(this.convCD<=0){this.isConv=true;this.convPh=0;}}
    else{this.convPh+=dt;
      if(this.convPh<.7) this.convF=Math.max(.05,1-this.convPh/.7*.78);
      else if(this.convPh<1.55) this.convF=.22+(this.convPh-.7)/.85*.9;
      else if(this.convPh<2.3) this.convF=1.12-(this.convPh-1.55)/.75*.12;
      else{this.convF=1;this.isConv=false;this.convCD=6+Math.random()*5;}}
    const mFrac=Math.hypot(this.hmx-cx,this.hmy-cy)/sc;
    for(let i=0;i<9;i++){const rg=this.rings[i];
      rg.rot+=rg.angV*(this.rotSpeed/100)*dt;
      const prox=Math.max(0,1-Math.abs(mFrac-rg.f)/.065);
      const amp=(.28-i*.014)+prox*.38;
      rg.r=rg.f*sc*this.convF*(1+amp*Math.sin(rg.freq*this.t+rg.ph));}}
  render(){const ctx=this.ctx,W=this.W,H=this.H;const cx=W*.5,cy=H*.5;
    const sc=Math.min(W,H)*.47;
    ctx.globalAlpha=.19;ctx.fillStyle='#000a04';ctx.fillRect(0,0,W,H);ctx.globalAlpha=1;
    /* Radial spoke grid (very faint) */
    ctx.save();ctx.globalAlpha=.028;ctx.strokeStyle='#00ff88';ctx.lineWidth=.3;
    for(let s=0;s<18;s++){const a=s/18*Math.PI*2;ctx.beginPath();ctx.moveTo(cx,cy);ctx.lineTo(cx+Math.cos(a)*sc*.92,cy+Math.sin(a)*sc*.92);ctx.stroke();}
    /* Faint cross-ring connector lines */
    for(let k=0;k<8;k++){for(let s=0;s<8;s++){const a=s/8*Math.PI*2+this.rings[k].rot;
      ctx.beginPath();ctx.moveTo(cx+Math.cos(a)*this.rings[k].r,cy+Math.sin(a)*this.rings[k].r);ctx.lineTo(cx+Math.cos(a)*this.rings[k+1].r,cy+Math.sin(a)*this.rings[k+1].r);ctx.stroke();}}
    ctx.restore();
    /* Rings as segmented rotating arcs */
    for(let i=0;i<9;i++){const rg=this.rings[i];if(rg.r<2)continue;
      const br=.5+.5*Math.sin(rg.freq*this.t+rg.ph+Math.PI*.5);
      const lw=rg.w*(.35+br*.9);const glow=this.isConv&&this.convPh<1?22:3+br*11;
      const GAP=.18; // 18% gap between segments
      ctx.save();ctx.strokeStyle=rg.col;ctx.lineWidth=lw;ctx.shadowBlur=glow;ctx.shadowColor=rg.col;ctx.globalAlpha=.42+br*.46;
      for(let s=0;s<rg.segs;s++){const a0=s/rg.segs*Math.PI*2+rg.rot;const a1=(s/rg.segs+(1-GAP)/rg.segs)*Math.PI*2+rg.rot;ctx.beginPath();ctx.arc(cx,cy,rg.r,a0,a1);ctx.stroke();}
      /* Bright white inner edge */
      ctx.strokeStyle='rgba(255,255,255,.55)';ctx.lineWidth=lw*.16;ctx.shadowBlur=2;ctx.globalAlpha=.14+br*.16;
      for(let s=0;s<rg.segs;s++){const a0=s/rg.segs*Math.PI*2+rg.rot;const a1=(s/rg.segs+(1-GAP)/rg.segs)*Math.PI*2+rg.rot;ctx.beginPath();ctx.arc(cx,cy,rg.r,a0,a1);ctx.stroke();}
      /* Segment-start glowing nodes */
      ctx.fillStyle=rg.col;ctx.shadowBlur=glow*.65;ctx.globalAlpha=.65+br*.3;
      for(let s=0;s<rg.segs;s++){const a=s/rg.segs*Math.PI*2+rg.rot;
        ctx.beginPath();ctx.arc(cx+Math.cos(a)*rg.r,cy+Math.sin(a)*rg.r,.55+br*1.1,0,Math.PI*2);ctx.fill();}
      ctx.restore();}
    /* Central pulsing core */
    ctx.save();const cp=.5+.5*Math.sin(this.t*8*(this.rotSpeed/100));
    ctx.strokeStyle=`rgba(0,255,170,${.45+cp*.45})`;ctx.lineWidth=.7+cp*.6;ctx.shadowBlur=10+cp*16;ctx.shadowColor='#00ffaa';
    ctx.beginPath();ctx.arc(cx,cy,sc*.022,0,Math.PI*2);ctx.stroke();ctx.restore();
    /* Convergence flash */
    if(this.isConv&&this.convPh<1.2){const fa=Math.max(0,.85-this.convF)*.55;
      const fg=ctx.createRadialGradient(cx,cy,0,cx,cy,sc);fg.addColorStop(0,`rgba(180,255,220,${fa})`);fg.addColorStop(1,'transparent');ctx.fillStyle=fg;ctx.fillRect(0,0,W,H);}
    ctx.globalAlpha=1;ctx.shadowBlur=0;}
  destroy(){this.c.removeEventListener('mousemove',this._mm);}}
class ViscousEclipse{
  constructor(c){this.c=c;this.ctx=c.getContext('2d');this.W=c.width;this.H=c.height;this.t=0;this.viscosity=60;
    this.N=1800;
    this.r=new Float32Array(this.N);this.theta=new Float32Array(this.N);
    this.infall=new Float32Array(this.N);this.arm=new Uint8Array(this.N);
    this.omega=new Float32Array(this.N); /* pre-computed angular velocity for streak render */
    this._initOrbits();
    this.lx=-9999;this.ly=-9999;this.drag=false;
    this._mm=e=>{const r=this.c.getBoundingClientRect();this.lx=e.clientX-r.left;this.ly=e.clientY-r.top;};
    this._md=()=>this.drag=true;this._mu=()=>this.drag=false;
    c.addEventListener('mousemove',this._mm);c.addEventListener('mousedown',this._md);c.addEventListener('mouseup',this._mu);}
  action(){/* Collapse — spike infall, particles rush inward then reset */
    for(let i=0;i<this.N;i++)this.infall[i]+=1.5+Math.random()*2.5;}
  _initOrbits(){const maxR=Math.min(this.W,this.H)*.46;
    for(let i=0;i<this.N;i++){this.arm[i]=i%6;
      this.r[i]=maxR*(.06+Math.random()*.9);
      /* Logarithmic spiral initial distribution — arms maintain shape */
      this.theta[i]=(this.arm[i]/6)*Math.PI*2-Math.log(Math.max(this.r[i],1)/10)*.85+(Math.random()-.5)*.3;
      this.infall[i]=.04+Math.random()*.1;}}
  resize(w,h){this.W=w;this.H=h;this._initOrbits();}
  update(dt){this.t+=dt;
    const maxR=Math.min(this.W,this.H)*.46;
    const KC=38*(this.viscosity/60);/* Keplerian constant */
    const fallMul=dt*(this.viscosity/60);
    const cx=this.W*.5,cy=this.H*.5;
    for(let i=0;i<this.N;i++){let r=this.r[i];
      if(r<4){/* Reset to outer edge — new arm position */
        this.r[i]=maxR*(.72+Math.random()*.26);r=this.r[i];
        this.theta[i]=(this.arm[i]/6)*Math.PI*2-Math.log(r/10)*.85+(Math.random()-.5)*.3;
        this.infall[i]=.04+Math.random()*.1;continue;}
      /* Keplerian omega ∝ r^-1.5 */
      const om=KC/Math.pow(r,1.5);this.omega[i]=om;this.theta[i]+=om*dt;
      /* Spiral infall — r decreases, faster close in */
      this.r[i]=Math.max(0,this.r[i]-this.infall[i]*fallMul*(12/Math.max(r,.1))*.55);
      /* Mouse secondary lens: gentle tidal push */
      if(this.drag){const px=cx+Math.cos(this.theta[i])*r,py=cy+Math.sin(this.theta[i])*r;
        const ldx=this.lx-px,ldy=this.ly-py,ld=Math.hypot(ldx,ldy)+1;
        if(ld<110){const f=.28*(1-ld/110);
          this.theta[i]+=(ldx*Math.sin(this.theta[i])-ldy*Math.cos(this.theta[i]))*f*dt;
          this.r[i]+=Math.min(2,(ldx*Math.cos(this.theta[i])+ldy*Math.sin(this.theta[i]))*f*dt*.4);}}}}
  render(){const ctx=this.ctx,W=this.W,H=this.H;const cx=W*.5,cy=H*.5;
    const maxR=Math.min(W,H)*.46;
    ctx.globalAlpha=.18;ctx.fillStyle='#000208';ctx.fillRect(0,0,W,H);ctx.globalAlpha=1;
    /* Polar background grid */
    ctx.save();ctx.globalAlpha=.04;ctx.strokeStyle='#1a3355';ctx.lineWidth=.4;
    for(let i=0;i<12;i++){const a=i/12*Math.PI*2;ctx.beginPath();ctx.moveTo(cx,cy);ctx.lineTo(cx+Math.cos(a)*maxR,cy+Math.sin(a)*maxR);ctx.stroke();}
    for(let r=maxR*.2;r<=maxR;r+=maxR*.2){ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);ctx.stroke();}
    ctx.restore();
    /* Dark central void + event horizon ring */
    ctx.save();
    const vR=Math.min(W,H)*.04;
    const vg=ctx.createRadialGradient(cx,cy,0,cx,cy,vR*3.5);
    vg.addColorStop(0,'rgba(0,0,0,1)');vg.addColorStop(.55,'rgba(0,0,0,.85)');vg.addColorStop(1,'transparent');
    ctx.fillStyle=vg;ctx.beginPath();ctx.arc(cx,cy,vR*3.5,0,Math.PI*2);ctx.fill();
    ctx.strokeStyle='rgba(130,145,175,.55)';ctx.lineWidth=.7;ctx.shadowBlur=9;ctx.shadowColor='#8899aa';
    ctx.beginPath();ctx.arc(cx,cy,vR,0,Math.PI*2);ctx.stroke();
    /* Outer photon ring shimmer */
    const pg=ctx.createRadialGradient(cx,cy,vR*2.5,cx,cy,vR*4.5);
    pg.addColorStop(0,'transparent');pg.addColorStop(.4,'rgba(160,170,210,.04)');pg.addColorStop(1,'transparent');
    ctx.fillStyle=pg;ctx.fillRect(0,0,W,H);
    ctx.restore();
    /* Orbital particles — tangential velocity streaks */
    ctx.save();ctx.globalCompositeOperation='screen';ctx.lineCap='round';
    for(let i=0;i<this.N;i++){const r=this.r[i];if(r<4)continue;
      const t=r/maxR; /* 0=inner hot, 1=outer cold */
      let R,G,B,a;
      if(t<.1){R=220;G=230;B=255;a=.9-t*5;}
      else if(t<.28){const f=(t-.1)/.18;R=255;G=Math.floor(200-f*120);B=Math.floor(255-f*230);a=.7-f*.12;}
      else if(t<.58){const f=(t-.28)/.3;R=Math.floor(255-f*170);G=Math.floor(80-f*60);B=Math.floor(25+f*15);a=.58-f*.2;}
      else{const f=(t-.58)/.42;R=Math.floor(85-f*65);G=20;B=Math.floor(40-f*30);a=.38-f*.32;}
      if(a<=0.01)continue;
      ctx.globalAlpha=a;
      const px=cx+Math.cos(this.theta[i])*r,py=cy+Math.sin(this.theta[i])*r;
      /* Tangential direction */
      const tx=-Math.sin(this.theta[i]),ty=Math.cos(this.theta[i]);
      const streakL=Math.min(this.omega[i]*r*.022,12);
      ctx.strokeStyle=`rgb(${R},${G},${B})`;ctx.lineWidth=Math.max(.3,.9-t*.55);
      ctx.shadowBlur=t<.18?4:0;ctx.shadowColor=`rgb(${R},${G},${B})`;
      if(streakL>0.5){ctx.beginPath();ctx.moveTo(px,py);ctx.lineTo(px-tx*streakL,py-ty*streakL);ctx.stroke();}
      else{ctx.fillStyle=`rgb(${R},${G},${B})`;ctx.fillRect(px-.4,py-.4,.8,.8);}}
    ctx.restore();ctx.globalAlpha=1;ctx.shadowBlur=0;}
  destroy(){this.c.removeEventListener('mousemove',this._mm);this.c.removeEventListener('mousedown',this._md);this.c.removeEventListener('mouseup',this._mu);}}
class PsionicMatrix{
  constructor(c){this.c=c;this.ctx=c.getContext('2d');this.W=c.width;this.H=c.height;this.t=0;this.boltCount=22;
    this.bolts=[];for(let i=0;i<22;i++)this.bolts.push(this._nb());
    this.SA=300;this.sx=new Float32Array(this.SA);this.sy=new Float32Array(this.SA);this.svx=new Float32Array(this.SA);this.svy=new Float32Array(this.SA);this.sa=new Float32Array(this.SA);this.sc=new Uint8Array(this.SA);this.ss=new Float32Array(this.SA);for(let i=0;i<this.SA;i++)this._rs(i);
    this.IP=1200;this.ix=new Float32Array(this.IP);this.iy=new Float32Array(this.IP);this.ivx=new Float32Array(this.IP);this.ivy=new Float32Array(this.IP);this.il=new Float32Array(this.IP);this.is=new Float32Array(this.IP);this.ic=new Uint8Array(this.IP);this.ia=new Uint8Array(this.IP);
    this.rings=[];this._mc=e=>{const r=this.c.getBoundingClientRect();this._impl(e.clientX-r.left,e.clientY-r.top);};c.addEventListener('click',this._mc);}
  action(){this._impl(this.W*.5,this.H*.5);}
  _nb(){const W=this.W,H=this.H,m=Math.random();let x0,y0,x1,y1;if(m<.4){x0=Math.random()*W;y0=0;x1=Math.random()*W;y1=H;}else if(m<.7){x0=0;y0=Math.random()*H;x1=W;y1=Math.random()*H;}else{x0=Math.random()*W;y0=Math.random()*H;x1=Math.random()*W;y1=Math.random()*H;}return{pts:this._fl(x0,y0,x1,y1,7),life:1,decay:.8+Math.random()*2.5,sd:Math.random()*.5,h:Math.random()<.55?0:1,w:.5+Math.random()*1.8};}
  _fl(x0,y0,x1,y1,d){if(d<=0)return[{x:x0,y:y0},{x:x1,y:y1}];const l=Math.hypot(x1-x0,y1-y0),mx=(x0+x1)*.5+(Math.random()-.5)*l*.55,my=(y0+y1)*.5+(Math.random()-.5)*l*.55;const L=this._fl(x0,y0,mx,my,d-1),R=this._fl(mx,my,x1,y1,d-1);return[...L.slice(0,-1),{x:mx,y:my},...R];}
  _rs(i){this.sx[i]=Math.random()*this.W;this.sy[i]=Math.random()*this.H;this.svx[i]=(Math.random()-.5)*160;this.svy[i]=(Math.random()-.5)*160;this.sa[i]=.2+Math.random()*.6;this.sc[i]=i%3;this.ss[i]=.4+Math.random()*1.8;}
  _impl(x,y){if(this.rings.length>=12)this.rings.shift();this.rings.push({x,y,r:0,life:1});let sp=0;for(let i=0;i<this.IP&&sp<120;i++){if(this.ia[i])continue;this.ia[i]=1;this.ix[i]=x;this.iy[i]=y;const a=Math.random()*Math.PI*2,s=60+Math.random()*280;this.ivx[i]=Math.cos(a)*s;this.ivy[i]=Math.sin(a)*s;this.il[i]=1;this.is[i]=1+Math.random()*3;this.ic[i]=i%3;sp++;}}
  resize(w,h){this.W=w;this.H=h;this.bolts=this.bolts.map(()=>this._nb());}
  update(dt){this.t+=dt;const target=Math.round(this.boltCount);while(this.bolts.length<target)this.bolts.push(this._nb());while(this.bolts.length>target)this.bolts.pop();
    for(let i=0;i<this.bolts.length;i++){this.bolts[i].sd-=dt;if(this.bolts[i].sd>0)continue;this.bolts[i].life-=this.bolts[i].decay*dt;if(this.bolts[i].life<=0)this.bolts[i]=this._nb();}
    for(let i=0;i<this.SA;i++){this.svx[i]+=(Math.random()-.5)*500*dt;this.svy[i]+=(Math.random()-.5)*500*dt;const s=Math.hypot(this.svx[i],this.svy[i]);if(s>280){this.svx[i]*=.78;this.svy[i]*=.78;}this.sx[i]+=this.svx[i]*dt;this.sy[i]+=this.svy[i]*dt;if(this.sx[i]<0)this.sx[i]=this.W;else if(this.sx[i]>this.W)this.sx[i]=0;if(this.sy[i]<0)this.sy[i]=this.H;else if(this.sy[i]>this.H)this.sy[i]=0;}
    for(let i=0;i<this.IP;i++){if(!this.ia[i])continue;this.il[i]-=dt*1.4;this.ix[i]+=this.ivx[i]*dt;this.iy[i]+=this.ivy[i]*dt;this.ivx[i]*=.93;this.ivy[i]*=.93;if(this.il[i]<=0)this.ia[i]=0;}
    for(let i=this.rings.length-1;i>=0;i--){this.rings[i].r+=dt*380;this.rings[i].life-=dt*1.8;if(this.rings[i].life<=0)this.rings.splice(i,1);}}
  render(){const ctx=this.ctx,W=this.W,H=this.H;ctx.globalAlpha=.18;ctx.fillStyle='#000005';ctx.fillRect(0,0,W,H);ctx.globalAlpha=1;const ng=ctx.createRadialGradient(W*.5,H*.5,0,W*.5,H*.5,Math.min(W,H)*.7);ng.addColorStop(0,'rgba(20,8,80,.12)');ng.addColorStop(1,'transparent');ctx.fillStyle=ng;ctx.fillRect(0,0,W,H);const SC=['#4488ff','#8844ff','#aaccff'];for(let i=0;i<this.SA;i++){ctx.globalAlpha=this.sa[i]*.6;ctx.fillStyle=SC[this.sc[i]];const s=this.ss[i];ctx.fillRect(this.sx[i]-s*.5,this.sy[i]-s*.5,s,s);}ctx.save();for(const b of this.bolts){if(b.sd>0||b.pts.length<2)continue;const col=b.h===0?'#4488ff':'#8844cc';ctx.globalAlpha=b.life*.5;ctx.strokeStyle=col;ctx.lineWidth=b.w+2.5;ctx.shadowBlur=22;ctx.shadowColor=col;ctx.lineCap='round';ctx.beginPath();ctx.moveTo(b.pts[0].x,b.pts[0].y);for(let j=1;j<b.pts.length;j++)ctx.lineTo(b.pts[j].x,b.pts[j].y);ctx.stroke();ctx.globalAlpha=b.life*.85;ctx.strokeStyle='#fff';ctx.lineWidth=b.w*.35;ctx.shadowBlur=6;ctx.beginPath();ctx.moveTo(b.pts[0].x,b.pts[0].y);for(let j=1;j<b.pts.length;j++)ctx.lineTo(b.pts[j].x,b.pts[j].y);ctx.stroke();}ctx.restore();for(const rg of this.rings){ctx.save();ctx.globalAlpha=rg.life*.7;ctx.strokeStyle='#4488ff';ctx.lineWidth=1.5;ctx.shadowBlur=18;ctx.shadowColor='#4488ff';ctx.beginPath();ctx.arc(rg.x,rg.y,rg.r,0,Math.PI*2);ctx.stroke();ctx.restore();}const IC=['#fff','#4488ff','#cc88ff'];for(let i=0;i<this.IP;i++){if(!this.ia[i])continue;ctx.globalAlpha=this.il[i];ctx.fillStyle=IC[this.ic[i]];const s=this.is[i];ctx.fillRect(this.ix[i]-s*.5,this.iy[i]-s*.5,s,s);}ctx.shadowBlur=0;ctx.globalAlpha=1;}
  destroy(){this.c.removeEventListener('click',this._mc);}}
class GenesisSigil{
  constructor(c){this.c=c;this.ctx=c.getContext('2d');this.W=c.width;this.H=c.height;this.t=0;this.speedMul=100;
    this.hmx=c.width*.5;this.hmy=c.height*.5;this.hov=0;
    const sc=Math.min(this.W,this.H)*.46;
    this.rDefs=[{f:.14,n:9,spd:1,d:1,col:'#cc2200'},{f:.26,n:7,spd:.636,d:-1,col:'#ff6600'},{f:.4,n:11,spd:.409,d:1,col:'#ffaa00'},{f:.56,n:5,spd:.257,d:-1,col:'#ffdd00'},{f:.72,n:13,spd:.165,d:1,col:'#ff8800'},{f:.88,n:6,spd:.103,d:-1,col:'#cc4400'}];
    this.rings=this.rDefs.map(d=>({...d,r:d.f*sc,rot:0}));
    this.DP=600;this.dangle=new Float32Array(this.DP);this.dr=new Float32Array(this.DP);this.ddx=new Float32Array(this.DP);this.ddy=new Float32Array(this.DP);this.dspd=new Float32Array(this.DP);this.da=new Float32Array(this.DP);this.dfade=new Float32Array(this.DP);this.dc=new Uint8Array(this.DP);for(let i=0;i<this.DP;i++)this._rd(i);
    this._mm=e=>{const r=this.c.getBoundingClientRect();this.hmx=e.clientX-r.left;this.hmy=e.clientY-r.top;};c.addEventListener('mousemove',this._mm);}
  action(){this.speedMul=Math.min(500,this.speedMul+100);}
  _rd(i){const ri=Math.floor(Math.random()*this.rings.length);this.dr[i]=this.rings[ri].r+(Math.random()-.5)*12;this.dangle[i]=Math.random()*Math.PI*2;this.dspd[i]=(.06+Math.random()*.18)*(Math.random()<.5?1:-1);this.da[i]=Math.random();this.dfade[i]=Math.random()<.5?1:-1;this.dc[i]=i%4;}
  resize(w,h){this.W=w;this.H=h;const sc=Math.min(w,h)*.46;this.rings=this.rDefs.map(d=>({...d,r:d.f*sc,rot:0}));for(let i=0;i<this.DP;i++)this._rd(i);}
  update(dt){this.t+=dt;const cx=this.W*.5,cy=this.H*.5;const tgt=Math.hypot(this.hmx-cx,this.hmy-cy)<Math.min(this.W,this.H)*.44?1:0;this.hov+=(tgt-this.hov)*dt*3.5;const spd=(this.speedMul/100)*(1+this.hov*3);for(const r of this.rings)r.rot+=r.spd*r.d*spd*dt;for(let i=0;i<this.DP;i++){this.dangle[i]+=this.dspd[i]*spd*dt;this.ddx[i]=cx+Math.cos(this.dangle[i])*this.dr[i];this.ddy[i]=cy+Math.sin(this.dangle[i])*this.dr[i];this.da[i]+=this.dfade[i]*dt*.7;if(this.da[i]>1){this.da[i]=1;this.dfade[i]=-1;}if(this.da[i]<0)this._rd(i);}}
  _star(ctx,cx,cy,r,n,rot,col,lw,hov){const k=Math.max(2,Math.floor(n*.4));ctx.save();ctx.strokeStyle=col;ctx.lineWidth=lw;ctx.shadowBlur=4+hov*12;ctx.shadowColor=col;ctx.globalAlpha=.35+hov*.55;ctx.beginPath();for(let i=0;i<=n;i++){const a=i*k/n*Math.PI*2+rot;i===0?ctx.moveTo(cx+Math.cos(a)*r,cy+Math.sin(a)*r):ctx.lineTo(cx+Math.cos(a)*r,cy+Math.sin(a)*r);}ctx.stroke();ctx.fillStyle=col;ctx.globalAlpha=.6+hov*.4;for(let i=0;i<n;i++){const a=i/n*Math.PI*2+rot;ctx.beginPath();ctx.arc(cx+Math.cos(a)*r,cy+Math.sin(a)*r,1.2+hov*1.8,0,Math.PI*2);ctx.fill();}ctx.restore();}
  render(){const ctx=this.ctx,W=this.W,H=this.H,cx=W*.5,cy=H*.5;if(this.bg===false){ctx.globalCompositeOperation='destination-out';ctx.fillStyle='rgba(0,0,0,0.22)';ctx.fillRect(0,0,W,H);ctx.globalCompositeOperation='source-over';}else{ctx.globalAlpha=.22;ctx.fillStyle='#060100';ctx.fillRect(0,0,W,H);ctx.globalAlpha=1;}const ag=ctx.createRadialGradient(cx,cy,0,cx,cy,Math.min(W,H)*.46);ag.addColorStop(0,'rgba(255,80,0,'+(.04+this.hov*.08)+')');ag.addColorStop(1,'transparent');ctx.fillStyle=ag;ctx.fillRect(0,0,W,H);for(const rg of this.rings){ctx.save();ctx.strokeStyle=rg.col;ctx.lineWidth=rg.spd*.8+this.hov*1.2;ctx.shadowBlur=5+this.hov*12;ctx.shadowColor=rg.col;ctx.globalAlpha=.3+this.hov*.55;ctx.beginPath();ctx.arc(cx,cy,rg.r,0,Math.PI*2);ctx.stroke();ctx.restore();this._star(ctx,cx,cy,rg.r,rg.n,rg.rot,rg.col,Math.max(.3,rg.spd*.8),this.hov);}ctx.save();const cC=['#ffaa00','#ff6600','#fff','#ff4400'];for(let i=0;i<4;i++){const rr=Math.min(W,H)*(.01+i*.012);ctx.strokeStyle=cC[i];ctx.lineWidth=.8+this.hov*.5;ctx.shadowBlur=6+this.hov*10;ctx.shadowColor=cC[i];ctx.globalAlpha=.6+this.hov*.4;ctx.beginPath();for(let j=0;j<6;j++){const a0=j/6*Math.PI*2+this.t*2*(.3+i*.2),a1=a0+Math.PI/6;ctx.moveTo(cx+Math.cos(a0)*rr,cy+Math.sin(a0)*rr);ctx.lineTo(cx+Math.cos(a1)*rr,cy+Math.sin(a1)*rr);}ctx.stroke();}ctx.restore();const DC=['#ff8800','#ffdd00','#ff4400','#fff'];for(let i=0;i<this.DP;i++){ctx.globalAlpha=this.da[i]*(.3+this.hov*.4);ctx.fillStyle=DC[this.dc[i]];ctx.fillRect(this.ddx[i]-.7,this.ddy[i]-.7,1.4,1.4);}ctx.shadowBlur=0;ctx.globalAlpha=1;}
  destroy(){this.c.removeEventListener('mousemove',this._mm);}}
class DeconstructionField{
  constructor(c){this.c=c;this.ctx=c.getContext('2d');this.W=c.width;this.H=c.height;this.t=0;this.shatterForce=100;
    this.hmx=-9999;this.hmy=-9999;this.COLS=20;this.ROWS=12;this.tiles=[];this.noiseCv=document.createElement('canvas');this._bt();this._bn();
    this._mm=e=>{const r=this.c.getBoundingClientRect();this.hmx=e.clientX-r.left;this.hmy=e.clientY-r.top;};c.addEventListener('mousemove',this._mm);}
  action(){for(const tile of this.tiles){const f=this.shatterForce/100*800;tile.vx+=(Math.random()-.5)*f;tile.vy+=(Math.random()-.5)*f;tile.omega+=(Math.random()-.5)*.3;}}
  _bt(){this.tiles.length=0;const tw=this.W/this.COLS,th=this.H/this.ROWS;for(let row=0;row<this.ROWS;row++)for(let col=0;col<this.COLS;col++){const ox=col*tw,oy=row*th;this.tiles.push({ox,oy,x:ox,y:oy,vx:0,vy:0,angle:0,omega:0,a:1,w:tw,h:th,ph:Math.random()*Math.PI*2});}}
  _bn(){const w=Math.max(this.W,800),h=Math.max(this.H,600);this.noiseCv.width=w;this.noiseCv.height=h;const ctx=this.noiseCv.getContext('2d');const id=ctx.createImageData(w,h);const d=id.data;for(let i=0;i<d.length;i+=4){const v=Math.random()<.5?0:255;const gv=((Math.floor(i/4)%w)%40<1)||((Math.floor((i/4)/w))%30<1)?60:v;d[i]=gv;d[i+1]=gv;d[i+2]=gv;d[i+3]=255;}ctx.putImageData(id,0,0);}
  resize(w,h){this.W=w;this.H=h;this._bt();if(w!==this.noiseCv.width||h!==this.noiseCv.height)this._bn();}
  update(dt){this.t+=dt;const mx=this.hmx,my=this.hmy,sf=this.shatterForce/100;for(const tile of this.tiles){const tcx=tile.x+tile.w*.5,tcy=tile.y+tile.h*.5,dx=tcx-mx,dy=tcy-my,d=Math.hypot(dx,dy)+.001;if(d<180){const f=(180-d)/180*600*sf;tile.vx+=dx/d*f*dt;tile.vy+=dy/d*f*dt;tile.omega+=(Math.random()-.5)*f*.01*dt;}tile.vx+=(tile.ox-tile.x)*4*dt;tile.vy+=(tile.oy-tile.y)*4*dt;tile.omega+=-tile.angle*3*dt;tile.vx=Math.max(-800,Math.min(800,tile.vx))*Math.pow(.88,dt*60);tile.vy=Math.max(-800,Math.min(800,tile.vy))*Math.pow(.88,dt*60);tile.omega=Math.max(-5,Math.min(5,tile.omega))*Math.pow(.9,dt*60);tile.x+=tile.vx*dt;tile.y+=tile.vy*dt;tile.angle+=tile.omega*dt;tile.a=.7+.3*Math.sin(this.t*3+tile.ph);}}
  render(){const ctx=this.ctx,W=this.W,H=this.H;ctx.fillStyle='#000';ctx.fillRect(0,0,W,H);for(const tile of this.tiles){ctx.save();ctx.translate(tile.x+tile.w*.5,tile.y+tile.h*.5);ctx.rotate(tile.angle);ctx.globalAlpha=tile.a*.5;ctx.globalCompositeOperation='source-over';ctx.drawImage(this.noiseCv,tile.ox,tile.oy,tile.w,tile.h,-tile.w*.5,-tile.h*.5,tile.w,tile.h);ctx.globalAlpha=tile.a*.15;ctx.globalCompositeOperation='screen';ctx.save();ctx.translate(2,0);ctx.drawImage(this.noiseCv,tile.ox,tile.oy,tile.w,tile.h,-tile.w*.5,-tile.h*.5,tile.w,tile.h);ctx.restore();ctx.save();ctx.translate(-2,0);ctx.drawImage(this.noiseCv,tile.ox,tile.oy,tile.w,tile.h,-tile.w*.5,-tile.h*.5,tile.w,tile.h);ctx.restore();ctx.globalCompositeOperation='source-over';ctx.globalAlpha=tile.a*.3;ctx.strokeStyle='rgba(255,255,255,.5)';ctx.lineWidth=.4;ctx.strokeRect(-tile.w*.5,-tile.h*.5,tile.w,tile.h);ctx.restore();}ctx.globalAlpha=.04;ctx.fillStyle='#fff';for(let y=0;y<H;y+=3)ctx.fillRect(0,y,W,1);if(Math.random()<.04){ctx.globalAlpha=.18;ctx.fillStyle=Math.random()<.5?'rgba(255,0,0,.8)':'rgba(0,50,255,.8)';ctx.fillRect(0,Math.random()*H,W,Math.random()*4+1);}ctx.globalAlpha=1;}
  destroy(){this.c.removeEventListener('mousemove',this._mm);}}
class KineticOverdrive{
  constructor(c){this.c=c;this.ctx=c.getContext('2d');this.W=c.width;this.H=c.height;this.t=0;this.windCharge=0;
    const sc=Math.max(Math.min(c.width,c.height)*.42,1);
    /* Epicycloid trace trains: {R, r, d, angle, speed, col, trail[]} */
    this.trains=[
      {R:sc,  r:sc*.273, d:sc*.24, angle:0, speed:1.0,    col:'#00ccff', trail:[]},
      {R:sc,  r:sc*.182, d:sc*.17, angle:0, speed:-.618,  col:'#cc8844', trail:[]},
      {R:sc,  r:sc*.414, d:sc*.38, angle:Math.PI/4, speed:.382,   col:'#ff6600', trail:[]},
      {R:sc,  r:sc*.236, d:sc*.22, angle:Math.PI,   speed:-1.272, col:'#44aaff', trail:[]},
    ];
    this.burst=0;this.heat=0;this.baseOmega=1.2;
    /* Spark pool */
    this.SP=300;this.sx=new Float32Array(this.SP);this.sy=new Float32Array(this.SP);this.svx=new Float32Array(this.SP);this.svy=new Float32Array(this.SP);this.sl=new Float32Array(this.SP);this.sa=new Uint8Array(this.SP);this.scol=new Uint8Array(this.SP);this._ns=0;
    /* Faint gear wireframe references */
    this.gearAngle=0;
    this.dmx=c.width*.5;this.dmy=c.height*.5;this.dpx=c.width*.5;this.dpy=c.height*.5;this.down=false;this.cpx=null;this.cpy=null;
    this._mm=e=>{const r=this.c.getBoundingClientRect();this.dpx=this.dmx;this.dpy=this.dmy;this.dmx=e.clientX-r.left;this.dmy=e.clientY-r.top;if(this.down){const s=Math.hypot(this.dmx-this.dpx,this.dmy-this.dpy);this.windCharge=Math.min(this.windCharge+s*.004*10,100);}};
    this._md=()=>this.down=true;
    this._mu=()=>{if(this.down){this.burst=this.windCharge/100*10;this.heat=Math.min(1,this.windCharge/100);this.windCharge=0;}this.down=false;};
    c.addEventListener('mousemove',this._mm);c.addEventListener('mousedown',this._md);c.addEventListener('mouseup',this._mu);}
  trigger(x,y){this.cpx=x;this.cpy=y;}
  action(){this.burst=8;this.heat=1;}
  _spark(x,y,col){const i=this._ns%this.SP;this._ns++;this.sa[i]=1;this.sx[i]=x;this.sy[i]=y;const a=Math.random()*Math.PI*2,sp=40+Math.random()*100;this.svx[i]=Math.cos(a)*sp;this.svy[i]=Math.sin(a)*sp-30;this.sl[i]=1;this.scol[i]=col;}
  resize(w,h){this.W=w;this.H=h;const sc=Math.min(w,h)*.42;const rs=[.273,.182,.414,.236],ds=[.24,.17,.38,.22];for(let k=0;k<4;k++){this.trains[k].R=sc;this.trains[k].r=sc*rs[k];this.trains[k].d=sc*ds[k];this.trains[k].trail=[];}}
  update(dt){this.t+=dt;this.burst=Math.max(0,this.burst-dt*1.8);this.heat*=Math.pow(.97,dt*60);
    const omega=(this.baseOmega+this.burst)*(1+this.windCharge/100*.6)*dt;
    this.gearAngle+=omega;
    const cx=(this.cpx!=null?this.cpx:this.W*.5),cy=(this.cpy!=null?this.cpy:this.H*.5);
    for(let k=0;k<4;k++){const tr=this.trains[k];tr.angle+=tr.speed*omega;
      const ratio=tr.r>0.5?(tr.R-tr.r)/tr.r:1;
      /* Hypocycloid: inner rolling */
      const x=cx+(tr.R-tr.r)*Math.cos(tr.angle)+tr.d*Math.cos(ratio*tr.angle);
      const y=cy+(tr.R-tr.r)*Math.sin(tr.angle)-tr.d*Math.sin(ratio*tr.angle);
      tr.trail.push({x,y});
      const maxTr=Math.floor(500+this.burst*120);if(tr.trail.length>maxTr)tr.trail.shift();
      if(this.burst>3&&Math.random()<.25)this._spark(x,y,k%2);}
    for(let i=0;i<this.SP;i++){if(!this.sa[i])continue;this.svy[i]+=160*dt;this.sx[i]+=this.svx[i]*dt;this.sy[i]+=this.svy[i]*dt;this.sl[i]-=dt*2.5;if(this.sl[i]<=0)this.sa[i]=0;}}
  render(){const ctx=this.ctx,W=this.W,H=this.H;const cx=(this.cpx!=null?this.cpx:W*.5),cy=(this.cpy!=null?this.cpy:H*.5);
    /* Very slow fade — trails accumulate */
    if(this.bg===false){const fa=0.04+this.burst*.018;ctx.globalCompositeOperation='destination-out';ctx.fillStyle=`rgba(0,0,0,${fa})`;ctx.fillRect(0,0,W,H);ctx.globalCompositeOperation='source-over';}else{ctx.globalAlpha=0.04+this.burst*.018;ctx.fillStyle='#050300';ctx.fillRect(0,0,W,H);ctx.globalAlpha=1;}
    /* Heat glow */
    if(this.heat>.01){const hg=ctx.createRadialGradient(cx,cy,0,cx,cy,Math.min(W,H)*.5);hg.addColorStop(0,`rgba(255,100,0,${this.heat*.1})`);hg.addColorStop(1,'transparent');ctx.fillStyle=hg;ctx.fillRect(0,0,W,H);}
    /* Faint reference circles */
    ctx.save();ctx.globalAlpha=.04;ctx.strokeStyle='rgba(200,180,80,.6)';ctx.lineWidth=.6;
    for(const tr of this.trains){ctx.beginPath();ctx.arc(cx,cy,tr.R,0,Math.PI*2);ctx.stroke();}ctx.restore();
    /* Gear hub wireframes (very subtle) */
    ctx.save();ctx.globalAlpha=.07;
    for(let k=0;k<4;k++){const tr=this.trains[k];ctx.strokeStyle=tr.col;ctx.lineWidth=.5;
      const ang=this.gearAngle*tr.speed;const hx=cx+(tr.R-tr.r)*Math.cos(tr.angle),hy=cy+(tr.R-tr.r)*Math.sin(tr.angle);
      ctx.beginPath();ctx.arc(hx,hy,tr.r,0,Math.PI*2);ctx.stroke();}ctx.restore();
    /* Spirograph trails — the main visual */
    ctx.save();ctx.globalCompositeOperation='screen';ctx.lineCap='round';ctx.lineJoin='round';
    for(const tr of this.trains){const n=tr.trail.length;if(n<2)continue;
      /* Draw in segments, brighter toward the tip */
      const segLen=15;
      for(let s=0;s<n-1;s+=segLen){const end=Math.min(s+segLen,n-1);const progress=s/n;const alpha=.08+progress*.65;const lw=.3+(1-progress)*1.8+this.burst*.4;ctx.globalAlpha=alpha;ctx.lineWidth=lw;ctx.shadowBlur=2+this.burst*1.5;ctx.strokeStyle=tr.col;ctx.shadowColor=tr.col;ctx.beginPath();ctx.moveTo(tr.trail[s].x,tr.trail[s].y);for(let p=s+1;p<=end;p++)ctx.lineTo(tr.trail[p].x,tr.trail[p].y);ctx.stroke();}
      /* Bright moving tip */
      const tip=tr.trail[n-1];ctx.globalAlpha=1;ctx.shadowBlur=12+this.burst*6;ctx.shadowColor='#ffffff';ctx.fillStyle='#ffffff';ctx.beginPath();ctx.arc(tip.x,tip.y,1.2+this.burst*.5,0,Math.PI*2);ctx.fill();
      /* Secondary hot tip glow */
      ctx.globalAlpha=.6;ctx.shadowBlur=6;ctx.shadowColor=tr.col;ctx.fillStyle=tr.col;ctx.beginPath();ctx.arc(tip.x,tip.y,2.5+this.burst*.8,0,Math.PI*2);ctx.fill();}
    ctx.restore();
    /* Sparks */
    for(let i=0;i<this.SP;i++){if(!this.sa[i])continue;const lf=this.sl[i];ctx.globalAlpha=lf;ctx.fillStyle=lf>.5?['#ffcc00','#00ccff'][this.scol[i]]:['#ff6600','#0066aa'][this.scol[i]];ctx.fillRect(this.sx[i]-1,this.sy[i]-1,2,2);}
    /* Wind-up arc indicator */
    if(this.windCharge>0){ctx.save();ctx.globalAlpha=.5;ctx.strokeStyle='#ffcc00';ctx.lineWidth=2;ctx.setLineDash([4,4]);ctx.beginPath();ctx.arc(cx,cy,Math.min(W,H)*.12,0,Math.PI*2*this.windCharge/100);ctx.stroke();ctx.setLineDash([]);ctx.restore();}
    ctx.globalAlpha=1;ctx.shadowBlur=0;}
  destroy(){this.c.removeEventListener('mousemove',this._mm);this.c.removeEventListener('mousedown',this._md);this.c.removeEventListener('mouseup',this._mu);}}
class AbsoluteZeroFracture{
  constructor(c){this.c=c;this.ctx=c.getContext('2d');this.W=c.width;this.H=c.height;this.t=0;this.density=5;
    this.hmx=-9999;this.hmy=-9999;this.hpx=-9999;this.hpy=-9999;
    this.CP=3000;this.ccx=new Float32Array(this.CP);this.ccy=new Float32Array(this.CP);this.cex=new Float32Array(this.CP);this.cey=new Float32Array(this.CP);this.clen=new Float32Array(this.CP);this.cmx=new Float32Array(this.CP);this.cgrow=new Float32Array(this.CP);this.clife=new Float32Array(this.CP);this.cdecay=new Float32Array(this.CP);this.ctimer=new Float32Array(this.CP);this.cdepth=new Uint8Array(this.CP);this.cact=new Uint8Array(this.CP);this.cw=new Float32Array(this.CP);this.cc=new Uint8Array(this.CP);this._nf=0;
    this.MP=2000;this.mx=new Float32Array(this.MP);this.my=new Float32Array(this.MP);this.mvx=new Float32Array(this.MP);this.mvy=new Float32Array(this.MP);this.mlife=new Float32Array(this.MP);this.ms=new Float32Array(this.MP);this.mact=new Uint8Array(this.MP);this._nm=0;
    this.spT=0;this.frost=[];this._buildFrost();
    this._mm=e=>{const r=this.c.getBoundingClientRect();this.hpx=this.hmx;this.hpy=this.hmy;this.hmx=e.clientX-r.left;this.hmy=e.clientY-r.top;};c.addEventListener('mousemove',this._mm);}
  _buildFrost(){const W=this.W,H=this.H,sc=Math.min(W,H)/400;this.frost=[];for(let i=0;i<44;i++)this.frost.push({x:Math.random()*W,y:Math.random()*H,size:(18+Math.random()*65)*sc,angle:Math.random()*Math.PI,a:.06+Math.random()*.11});}
  action(){for(let i=0;i<this.CP;i++)this.cact[i]=0;for(let i=0;i<this.MP;i++)this.mact[i]=0;}
  _slot(){for(let i=0;i<this.CP;i++){const j=(this._nf+i)%this.CP;if(!this.cact[j]){this._nf=(j+1)%this.CP;return j;}}this._nf=(this._nf+1)%this.CP;return-1;}
  _mslot(){this._nm=this._nm%this.MP;const j=this._nm;this._nm=(this._nm+1)%this.MP;return j;}
  _sc(ox,oy,angle,depth){const s=this._slot();if(s<0)return;const sc=Math.min(this.W,this.H)/400;this.cact[s]=1;this.ccx[s]=ox;this.ccy[s]=oy;const ml=depth===0?(24+Math.random()*60)*sc:(13+Math.random()*28)*(1-.17*depth)*sc;this.cmx[s]=ml;this.clen[s]=0;this.cgrow[s]=(400+Math.random()*600)*sc;this.cex[s]=ox+Math.cos(angle)*ml;this.cey[s]=oy+Math.sin(angle)*ml;this.clife[s]=1;this.cdecay[s]=.7+Math.random()*1.9;this.ctimer[s]=0;this.cdepth[s]=depth;this.cw[s]=depth===0?1.6+Math.random()*.9:.45+Math.random()*.75;this.cc[s]=Math.floor(Math.random()*4);}
  _sm(x,y){for(let k=0;k<4;k++){const m=this._mslot();this.mact[m]=1;this.mx[m]=x+(Math.random()-.5)*6;this.my[m]=y+(Math.random()-.5)*6;const a=Math.random()*Math.PI*2,sp=14+Math.random()*32;this.mvx[m]=Math.cos(a)*sp;this.mvy[m]=Math.sin(a)*sp-14;this.mlife[m]=1;this.ms[m]=1+Math.random()*3;}}
  resize(w,h){this.W=w;this.H=h;this._buildFrost();}
  update(dt){this.t+=dt;const mx=this.hmx,my=this.hmy,spd=Math.hypot(mx-this.hpx,my-this.hpy);this.spT-=dt;this.autoT=(this.autoT||0)+dt;
    if(this.autoT>0.10){this.autoT=0;const ax=Math.random()*this.W,ay=Math.random()*this.H;const ba=Math.floor(Math.random()*6)/6*Math.PI*2;this._sc(ax,ay,ba,0);if(Math.random()<.70)this._sc(ax,ay,ba+Math.PI*2/3,0);if(Math.random()<.45)this._sc(ax,ay,ba+Math.PI*4/3,0);if(Math.random()<.24)this._sc(ax,ay,ba+Math.PI,0);}
    const cnt=Math.round(this.density);if(spd>2&&this.spT<=0&&mx>0){const n=Math.min(Math.floor(spd/5)+1,cnt);for(let i=0;i<n;i++){const t2=i/Math.max(n-1,1),bx=this.hpx+(mx-this.hpx)*t2,by=this.hpy+(my-this.hpy)*t2;const ba=Math.floor(Math.random()*6)/6*Math.PI*2;this._sc(bx,by,ba,0);if(Math.random()<.42)this._sc(bx,by,ba+Math.PI,0);}this.spT=.018;}
    for(let i=0;i<this.CP;i++){if(!this.cact[i])continue;if(this.clen[i]<this.cmx[i]){this.clen[i]+=this.cgrow[i]*dt;if(this.clen[i]>=this.cmx[i]){this.clen[i]=this.cmx[i];if(this.cdepth[i]<2){const bx=this.cex[i],by=this.cey[i],ba=Math.atan2(by-this.ccy[i],bx-this.ccx[i]),bn=3+Math.floor(Math.random()*3);for(let b=0;b<bn;b++){const da=(b/(bn-1)-.5)*Math.PI*.65+Math.floor(Math.random()*3)/3*Math.PI*2;this._sc(bx,by,ba+da,this.cdepth[i]+1);}}}}this.ctimer[i]+=dt;if(this.ctimer[i]>this.cdecay[i]){this.clife[i]-=dt*.85;if(this.clife[i]<=0){this._sm(this.cex[i],this.cey[i]);this.cact[i]=0;}}}
    for(let i=0;i<this.MP;i++){if(!this.mact[i])continue;this.mx[i]+=this.mvx[i]*dt;this.my[i]+=this.mvy[i]*dt;this.mvx[i]*=.96;this.mvy[i]*=.96;this.mlife[i]-=dt*1.0;if(this.mlife[i]<=0)this.mact[i]=0;}}
  render(){const ctx=this.ctx,W=this.W,H=this.H;ctx.globalAlpha=.20;ctx.fillStyle='#00020a';ctx.fillRect(0,0,W,H);ctx.globalAlpha=1;
    for(const f of this.frost){ctx.save();ctx.translate(f.x,f.y);ctx.rotate(f.angle);ctx.globalAlpha=f.a;ctx.strokeStyle='rgba(80,160,255,.75)';ctx.lineWidth=.8;for(let i=0;i<6;i++){const a=i/6*Math.PI*2;ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(Math.cos(a)*f.size,Math.sin(a)*f.size);ctx.stroke();const mid=f.size*.55,pa=a+Math.PI*.5;ctx.beginPath();ctx.moveTo(Math.cos(a)*mid+Math.cos(pa)*8,Math.sin(a)*mid+Math.sin(pa)*8);ctx.lineTo(Math.cos(a)*mid-Math.cos(pa)*8,Math.sin(a)*mid-Math.sin(pa)*8);ctx.stroke();const sub=f.size*.3,sb=a+Math.PI*.5;ctx.beginPath();ctx.moveTo(Math.cos(a)*sub+Math.cos(sb)*4,Math.sin(a)*sub+Math.sin(sb)*4);ctx.lineTo(Math.cos(a)*sub-Math.cos(sb)*4,Math.sin(a)*sub-Math.sin(sb)*4);ctx.stroke();}ctx.restore();}
    const CC=['#a0e8ff','#c8f4ff','#ffffff','#7fd0ff'];for(let i=0;i<this.CP;i++){if(!this.cact[i])continue;const gr=this.clen[i]/this.cmx[i],al=this.clife[i]*gr;const ang=Math.atan2(this.cey[i]-this.ccy[i],this.cex[i]-this.ccx[i]),ex=this.ccx[i]+Math.cos(ang)*this.clen[i],ey=this.ccy[i]+Math.sin(ang)*this.clen[i];ctx.save();ctx.globalAlpha=Math.min(1,al*1.6);ctx.strokeStyle=CC[this.cc[i]];ctx.lineWidth=this.cw[i]*2;ctx.shadowBlur=10;ctx.shadowColor='#88ccff';ctx.beginPath();ctx.moveTo(this.ccx[i],this.ccy[i]);ctx.lineTo(ex,ey);ctx.stroke();ctx.globalAlpha=al*.8;ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(ex,ey,this.cw[i]*1.2,0,Math.PI*2);ctx.fill();ctx.restore();}
    for(let i=0;i<this.MP;i++){if(!this.mact[i])continue;ctx.globalAlpha=this.mlife[i]*.55;ctx.fillStyle='#aaeeff';ctx.beginPath();ctx.arc(this.mx[i],this.my[i],this.ms[i],0,Math.PI*2);ctx.fill();}ctx.shadowBlur=0;ctx.globalAlpha=1;}
  destroy(){this.c.removeEventListener('mousemove',this._mm);}}
/* ─── INT FX WRAPPERS ────────────────────────────────── */
const intFX_INT1={
  init(d){
    try{d._sc=new QuantumOverride(d.canvas);d._sc.destroy();}catch(e){console.warn('[INT] INT1:',e);d._dead=true;return;}
    
  },
  frame(d,dt){
    if(!d._sc||d._dead)return;
    d._sc.mx=d.mOn?d.mx:d.W*.5;d._sc.my=d.mOn?d.my:d.H*.5;d._sc.repel=d.param*100+1;
    if(d.burst>0.5){d._sc.forceSnap=2;d.burst=0;}
    d._sc.update(dt,d.t||0);d._sc.render();
  },
  hud(d){return 'INT1 · '+(d.fps||'--')+'FPS';},
  onResize(d){if(d._sc){d._sc.resize(d.W,d.H);if(d.W>10&&d.H>10)d._sc._ip();}}
};
const intFX_INT2={
  init(d){
    try{d._sc=new AbyssalResonance(d.canvas);d._sc.destroy();}catch(e){console.warn('[INT] INT2:',e);d._dead=true;return;}
    d.canvas.addEventListener('pointerdown',e=>{const r=d.canvas.getBoundingClientRect();d._sc.wells.push({x:(e.clientX-r.left)*DPR,y:(e.clientY-r.top)*DPR,s:1});if(d._sc.wells.length>6)d._sc.wells.shift();});
  },
  frame(d,dt){
    if(!d._sc||d._dead)return;
    d._sc.flowSpeed=d.param*190+10;
    if(d.burst>0.5){d._sc.action&&d._sc.action();d.burst=0;}
    d._sc.update(dt,d.t||0);d._sc.render();
  },
  hud(d){return 'INT2 · '+(d.fps||'--')+'FPS';},
  onResize(d){if(d._sc){d._sc.resize(d.W,d.H);if(d.W>10&&d.H>10){const N=d._sc.N;for(let i=0;i<N;i++){d._sc.px[i]=Math.random()*d._sc.W;d._sc.py[i]=Math.random()*d._sc.H;d._sc.pvx[i]=0;d._sc.pvy[i]=0;}}}}
};
const intFX_INT3={
  init(d){
    try{d._sc=new SupernovaRemnant(d.canvas);d._sc.destroy();}catch(e){console.warn('[INT] INT3:',e);d._dead=true;return;}
    d.canvas.addEventListener('click',e=>{const r=d.canvas.getBoundingClientRect();const bx=(e.clientX-r.left)*DPR,by=(e.clientY-r.top)*DPR;d._sc._ring(bx,by);d._sc._miniBlast(bx,by);});
  },
  frame(d,dt){
    if(!d._sc||d._dead)return;
    d._sc.mpx=d._sc.msx;d._sc.mpy=d._sc.msy;d._sc.msx=d.mOn?d.mx:d._sc.W*.5;d._sc.msy=d.mOn?d.my:d._sc.H*.5;d._sc.burstStrength=d.param*180+20;
    if(d.burst>0.5){d._sc._burst(d._sc.W*.5,d._sc.H*.5);d._sc._ring(d._sc.W*.5,d._sc.H*.5);d.burst=0;}
    d._sc.update(dt,d.t||0);d._sc.render();
  },
  hud(d){return 'INT3 · '+(d.fps||'--')+'FPS';},
  onResize(d){if(d._sc){d._sc.resize(d.W,d.H);if(d.W>10&&d.H>10){d._sc._burst(d._sc.W*.5,d._sc.H*.5);d._sc._ring(d._sc.W*.5,d._sc.H*.5);}}}
};
const intFX_INT4={
  init(d){
    try{d._sc=new EtherealPhalanx(d.canvas);d._sc.destroy();}catch(e){console.warn('[INT] INT4:',e);d._dead=true;return;}
    
  },
  frame(d,dt){
    if(!d._sc||d._dead)return;
    d._sc.hmx=d.mOn?d.mx:d._sc.W*.5;d._sc.hmy=d.mOn?d.my:d._sc.H*.5;d._sc.rotSpeed=d.param*290+10;
    if(d.burst>0.5){if(!d._sc.isConv){d._sc.isConv=true;d._sc.convPh=0;}d.burst=0;}
    d._sc.update(dt,d.t||0);d._sc.render();
  },
  hud(d){return 'INT4 · '+(d.fps||'--')+'FPS';},
  onResize(d){if(d._sc)d._sc.resize(d.W,d.H);}
};
const intFX_INT5={
  init(d){
    try{d._sc=new ViscousEclipse(d.canvas);d._sc.destroy();}catch(e){console.warn('[INT] INT5:',e);d._dead=true;return;}
    d._ptDown=false;d.canvas.addEventListener('pointerdown',()=>{d._ptDown=true;d._sc.drag=true;});d.canvas.addEventListener('pointerup',()=>{d._ptDown=false;d._sc.drag=false;});
  },
  frame(d,dt){
    if(!d._sc||d._dead)return;
    d._sc.lx=d.mx;d._sc.ly=d.my;d._sc.viscosity=d.param*90+10;
    if(d.burst>0.5){d._sc.action&&d._sc.action();d.burst=0;}
    d._sc.update(dt,d.t||0);d._sc.render();
  },
  hud(d){return 'INT5 · '+(d.fps||'--')+'FPS';},
  onResize(d){if(d._sc)d._sc.resize(d.W,d.H);}
};
const intFX_INT6={
  init(d){
    try{d._sc=new PsionicMatrix(d.canvas);d._sc.destroy();}catch(e){console.warn('[INT] INT6:',e);d._dead=true;return;}
    d.canvas.addEventListener('click',e=>{const r=d.canvas.getBoundingClientRect();d._sc._impl((e.clientX-r.left)*DPR,(e.clientY-r.top)*DPR);});
  },
  frame(d,dt){
    if(!d._sc||d._dead)return;
    d._sc.boltCount=Math.round(d.param*35+5);
    if(d.burst>0.5){d._sc._impl(d._sc.W*.5,d._sc.H*.5);d.burst=0;}
    d._sc.update(dt,d.t||0);d._sc.render();
  },
  hud(d){return 'INT6 · '+(d.fps||'--')+'FPS';},
  onResize(d){if(d._sc)d._sc.resize(d.W,d.H);}
};
const intFX_INT7={
  init(d){
    try{d._sc=new GenesisSigil(d.canvas);d._sc.destroy();}catch(e){console.warn('[INT] INT7:',e);d._dead=true;return;}
    if(!d._castBound){d._castBound=e=>{const r=d.canvas.getBoundingClientRect();this.trigger(d,(e.clientX-r.left)*DPR,(e.clientY-r.top)*DPR);};d.canvas.addEventListener('click',d._castBound);}
  },
  trigger(d,x,y){d.tx=x;d.ty=y;},
  frame(d,dt){
    if(!d._sc||d._dead)return;
    d._sc.hmx=d.mOn?d.mx:(d.tx!=null?d.tx:d._sc.W*.5);d._sc.hmy=d.mOn?d.my:(d.ty!=null?d.ty:d._sc.H*.5);d._sc.speedMul=d.param*490+10;d._sc.bg=d.bg;
    if(d.burst>0.5){d._sc.speedMul=Math.min(500,(d._sc.speedMul||100)+100);d.burst=0;}
    d._sc.update(dt,d.t||0);d._sc.render();
  },
  hud(d){return 'INT7 · '+(d.fps||'--')+'FPS';},
  onResize(d){if(d._sc)d._sc.resize(d.W,d.H);}
};
const intFX_INT8={
  init(d){
    try{d._sc=new DeconstructionField(d.canvas);d._sc.destroy();}catch(e){console.warn('[INT] INT8:',e);d._dead=true;return;}
    
  },
  frame(d,dt){
    if(!d._sc||d._dead)return;
    d._sc.hmx=d.mOn?d.mx:-9999;d._sc.hmy=d.mOn?d.my:-9999;d._sc.shatterForce=d.param*200;
    if(d.burst>0.5){for(const t of d._sc.tiles){const f=(d._sc.shatterForce||100)/100*800;t.vx+=(Math.random()-.5)*f;t.vy+=(Math.random()-.5)*f;t.omega+=(Math.random()-.5)*.3;}d.burst=0;}
    d._sc.update(dt,d.t||0);d._sc.render();
  },
  hud(d){return 'INT8 · '+(d.fps||'--')+'FPS';},
  onResize(d){if(d._sc)d._sc.resize(d.W,d.H);}
};
const intFX_INT9={
  init(d){
    try{d._sc=new KineticOverdrive(d.canvas);d._sc.destroy();}catch(e){console.warn('[INT] INT9:',e);d._dead=true;return;}
    d._ptDown=false;d.canvas.addEventListener('pointerdown',()=>{d._ptDown=true;});d.canvas.addEventListener('pointerup',()=>{if(d._ptDown&&(d._sc.windCharge||0)>0){d._sc.burst=d._sc.windCharge/100*10;d._sc.heat=Math.min(1,d._sc.windCharge/100);d._sc.windCharge=0;}d._ptDown=false;});
    if(!d._castBound){d._castBound=e=>{const r=d.canvas.getBoundingClientRect();d._sc.trigger((e.clientX-r.left)*DPR,(e.clientY-r.top)*DPR);};d.canvas.addEventListener('click',d._castBound);}
  },
  trigger(d,x,y){if(d._sc)d._sc.trigger(x,y);},
  frame(d,dt){
    if(!d._sc||d._dead)return;
    d._sc.dpx=d._sc.dmx;d._sc.dpy=d._sc.dmy;d._sc.dmx=d.mx;d._sc.dmy=d.my;if(d._ptDown){const sp=Math.hypot(d.mx-d._sc.dpx,d.my-d._sc.dpy);d._sc.windCharge=Math.min((d._sc.windCharge||0)+sp*.003*10,100);}
    if(d.burst>0.5){d._sc.burst=8;d._sc.heat=1;d.burst=0;}
    d._sc.bg=d.bg;
    d._sc.update(dt,d.t||0);d._sc.render();
  },
  hud(d){return 'INT9 · '+(d.fps||'--')+'FPS';},
  onResize(d){if(d._sc)d._sc.resize(d.W,d.H);}
};
const intFX_INT10={
  init(d){
    try{d._sc=new AbsoluteZeroFracture(d.canvas);d._sc.destroy();}catch(e){console.warn('[INT] INT10:',e);d._dead=true;return;}
    
  },
  frame(d,dt){
    if(!d._sc||d._dead)return;
    d._sc.hpx=d._sc.hmx;d._sc.hpy=d._sc.hmy;d._sc.hmx=d.mOn?d.mx:-9999;d._sc.hmy=d.mOn?d.my:-9999;d._sc.density=d.param*9+1;
    if(d.burst>0.5){for(let i=0;i<d._sc.CP;i++)d._sc.cact[i]=0;for(let i=0;i<d._sc.MP;i++)d._sc.mact[i]=0;d.burst=0;}
    d._sc.update(dt,d.t||0);d._sc.render();
  },
  hud(d){return 'INT10 · '+(d.fps||'--')+'FPS';},
  onResize(d){if(d._sc)d._sc.resize(d.W,d.H);}
};

/* ===== PART IX · NOVA ARSENAL modules (N36–N45) ===== */
  /* ===== N36 ===== CELESTIAL STARFALL — 차원 균열 별가루 강우 + 바닥 탄성 반사 + 바람 와류 */
const FXN36=(function(){const TAU=Math.PI*2,clamp=(v,a,b)=>v<a?a:v>b?b:v,rnd=(a,b)=>a+Math.random()*(b-a);
 const COMET=80, SPARK=420, BOKEH=60;
 const PAL=[[255,236,170],[255,255,255],[150,225,255],[255,170,225]];
 return{
 init(d){
  d.cx=new Float32Array(COMET);d.cy=new Float32Array(COMET);d.cvx=new Float32Array(COMET);d.cvy=new Float32Array(COMET);
  d.clen=new Float32Array(COMET);d.ccol=new Uint8Array(COMET);d.cw=new Float32Array(COMET);d.cflare=new Float32Array(COMET);d.cf=new Float32Array(COMET);
  for(let i=0;i<COMET;i++)this.spawn(d,i,true);
  d.sx=new Float32Array(SPARK);d.sy=new Float32Array(SPARK);d.svx=new Float32Array(SPARK);d.svy=new Float32Array(SPARK);d.sl=new Float32Array(SPARK);d.scol=new Uint8Array(SPARK);d.ss=new Float32Array(SPARK);for(let i=0;i<SPARK;i++)d.sl[i]=0;d.si=0;
  d.bx=new Float32Array(BOKEH);d.by=new Float32Array(BOKEH);d.br=new Float32Array(BOKEH);d.bz=new Float32Array(BOKEH);for(let i=0;i<BOKEH;i++){d.bx[i]=Math.random();d.by[i]=Math.random();d.br[i]=rnd(2,9);d.bz[i]=rnd(.2,1);}
  d.wind=0;d.flareX=0;d.flareA=0;d.surge=0;d.ang=2.3;/* fall direction (rad), diagonal */},
 spawn(d,i,any){const W=d.W||800,H=d.H||440,S=Math.min(W,H);
  const ang=2.3+rnd(-.18,.18);const sp=rnd(0.5,1.3)*S;
  // start above the travel direction
  const margin=S*.3;d.cx[i]=rnd(-W*.1,W*1.1)-Math.cos(ang)*margin;d.cy[i]=rnd(-H*.4,H*.5)-Math.sin(ang)*margin*0+(-margin);
  if(!any){d.cx[i]=rnd(-W*.1,W*1.1);d.cy[i]=-rnd(20,H*.5);}
  d.cvx[i]=Math.cos(ang)*sp;d.cvy[i]=Math.sin(ang)*sp;d.clen[i]=rnd(.06,.2)*S;d.ccol[i]=Math.random()<.18?3:(Math.random()<.5?0:(Math.random()<.6?1:2));d.cw[i]=rnd(.6,2.2);d.cflare[i]=Math.random()<.25?1:0;d.cf[i]=0;},
 _spark(d,x,y,col,n,spread){for(let k=0;k<n;k++){const i=d.si;d.si=(d.si+1)%SPARK;const a=rnd(0,TAU),v=rnd(.1,1)*spread;d.sx[i]=x;d.sy[i]=y;d.svx[i]=Math.cos(a)*v;d.svy[i]=Math.sin(a)*v;d.sl[i]=rnd(.5,1);d.scol[i]=col;d.ss[i]=rnd(.6,1.8);}},
 _star(c,x,y,r,col,a){/* 4-point sparkle */c.fillStyle="rgba("+col[0]+","+col[1]+","+col[2]+","+a+")";c.beginPath();c.moveTo(x,y-r);c.quadraticCurveTo(x,y,x+r*.28,y);c.quadraticCurveTo(x,y,x,y+r);c.quadraticCurveTo(x,y,x-r*.28,y);c.quadraticCurveTo(x,y,x,y-r);c.fill();
  c.beginPath();c.moveTo(x-r,y);c.quadraticCurveTo(x,y,x,y-r*.28);c.quadraticCurveTo(x,y,x+r,y);c.quadraticCurveTo(x,y,x,y+r*.28);c.quadraticCurveTo(x,y,x-r,y);c.fill();},
 onBurst(d){d.surge=1;d.flareA=1;d.flareX=d.mOn?d.mx:d.W*.5;},
 frame(d,dt){const c=d.ctx,W=d.W,H=d.H,S=Math.min(W,H);
  // cinematic gradient sky
  if(d.bg===false){c.clearRect(0,0,W,H);}else{const g=c.createLinearGradient(0,0,W*.3,H);g.addColorStop(0,"#0a0820");g.addColorStop(.5,"#0c0a1e");g.addColorStop(1,"#050410");c.fillStyle=g;c.fillRect(0,0,W,H);}
  // drifting bokeh (parallax, soft defocus)
  c.save();c.globalCompositeOperation="lighter";
  for(let i=0;i<BOKEH;i++){const z=d.bz[i];let bx=(d.bx[i]+d.wind*0.00002*z*dt*0)*W;let by=((d.by[i]+d.t*0.01*z)%1)*H;bx=((d.bx[i]+d.t*0.004*z)%1)*W;const r=d.br[i]*(0.6+z);const a=0.04+z*0.08+0.03*Math.sin(d.t*2+i);const rg=c.createRadialGradient(bx,by,0,bx,by,r);rg.addColorStop(0,"rgba(180,210,255,"+a+")");rg.addColorStop(1,"rgba(120,160,255,0)");c.fillStyle=rg;c.beginPath();c.arc(bx,by,r,0,TAU);c.fill();}
  c.restore();
  // wind from swipe
  if(d.mOn){const tw=clamp((d.mx-W*.5)/(W*.5),-1,1)*1.2;d.wind+=(tw-d.wind)*Math.min(1,dt*2.5);}else d.wind*=Math.pow(.95,dt*60);
  d.surge*=Math.pow(.985,dt*60);d.flareA*=Math.pow(.9,dt*60);
  const focalY=H*0.5;
  // comets
  c.save();c.globalCompositeOperation="lighter";
  const spd=(0.7+d.param*0.9)*(1+d.surge*1.4);
  for(let i=0;i<COMET;i++){const col=PAL[d.ccol[i]];
   // curve by wind (perp accel)
   const vlen=Math.hypot(d.cvx[i],d.cvy[i])||1;const px=-d.cvy[i]/vlen,py=d.cvx[i]/vlen;
   d.cvx[i]+=px*d.wind*S*0.5*dt;d.cvy[i]+=py*d.wind*S*0.5*dt;
   d.cx[i]+=d.cvx[i]*dt*spd;d.cy[i]+=d.cvy[i]*dt*spd;
   // mouse swirl eddy
   if(d.mOn){const dx=d.mx-d.cx[i],dy=d.my-d.cy[i],dd=Math.hypot(dx,dy);if(dd<S*.18){const f=(1-dd/(S*.18));const tx=-dy/dd,ty=dx/dd;d.cvx[i]+=tx*f*S*1.4*dt;d.cvy[i]+=ty*f*S*1.4*dt;if(Math.random()<f*0.3)this._spark(d,d.cx[i],d.cy[i],d.ccol[i],1,S*.5);}}
   // focal-band flare (anime impact twinkle)
   const wasAbove=d.cf[i];const nowBelow=d.cy[i]>focalY?1:0;
   if(d.cflare[i]&&!wasAbove&&nowBelow){d.cf[i]=1;this._spark(d,d.cx[i],focalY,d.ccol[i],8,S*.9);d.flareA=Math.max(d.flareA,0.5);d.flareX=d.cx[i];}
   if(d.cy[i]>H+S*.25||d.cx[i]<-S*.3||d.cx[i]>W+S*.3){this.spawn(d,i,false);continue;}
   const nvx=d.cvx[i]/Math.hypot(d.cvx[i],d.cvy[i]),nvy=d.cvy[i]/Math.hypot(d.cvx[i],d.cvy[i]);
   const tx=d.cx[i]-nvx*d.clen[i],ty=d.cy[i]-nvy*d.clen[i];
   // trail gradient
   const tg=c.createLinearGradient(d.cx[i],d.cy[i],tx,ty);tg.addColorStop(0,"rgba("+col[0]+","+col[1]+","+col[2]+",0.95)");tg.addColorStop(.4,"rgba("+col[0]+","+col[1]+","+col[2]+",0.3)");tg.addColorStop(1,"rgba("+col[0]+","+col[1]+","+col[2]+",0)");
   c.strokeStyle=tg;c.lineWidth=d.cw[i]*1.6;c.lineCap="round";c.beginPath();c.moveTo(tx,ty);c.lineTo(d.cx[i],d.cy[i]);c.stroke();
   // chromatic head (RGB micro-offset)
   c.fillStyle="rgba(255,80,80,.5)";c.beginPath();c.arc(d.cx[i]-1,d.cy[i],d.cw[i]*1.1,0,TAU);c.fill();
   c.fillStyle="rgba(80,160,255,.5)";c.beginPath();c.arc(d.cx[i]+1,d.cy[i],d.cw[i]*1.1,0,TAU);c.fill();
   c.fillStyle="rgba(255,255,255,.95)";c.beginPath();c.arc(d.cx[i],d.cy[i],d.cw[i]*0.9,0,TAU);c.fill();
   // occasional twinkle on head
   if(d.cflare[i]&&Math.random()<.08)this._star(c,d.cx[i],d.cy[i],d.cw[i]*4,col,.6);}
  c.lineCap="butt";c.restore();
  // sparks (4-point stars)
  c.save();c.globalCompositeOperation="lighter";
  for(let i=0;i<SPARK;i++){if(d.sl[i]<=0)continue;d.svy[i]+=0.4*dt;d.sx[i]+=d.svx[i]*dt*60;d.sy[i]+=d.svy[i]*dt*60;d.svx[i]*=Math.pow(.94,dt*60);d.svy[i]*=Math.pow(.94,dt*60);d.sl[i]-=dt*1.1;const col=PAL[d.scol[i]],L=clamp(d.sl[i],0,1);this._star(c,d.sx[i],d.sy[i],d.ss[i]*2.6*L,col,L*.9);}
  c.restore();
  // anamorphic lens flare (tasteful horizontal streak) at focal flashes
  if(d.flareA>0.02){c.save();c.globalCompositeOperation="lighter";const fa=d.flareA;const fg=c.createLinearGradient(0,focalY,W,focalY);fg.addColorStop(0,"rgba(150,200,255,0)");fg.addColorStop(.5,"rgba(220,235,255,"+(fa*.5)+")");fg.addColorStop(1,"rgba(150,200,255,0)");c.fillStyle=fg;c.fillRect(0,focalY-2-fa*4,W,4+fa*8);
   const cg=c.createRadialGradient(d.flareX,focalY,0,d.flareX,focalY,S*.2*fa);cg.addColorStop(0,"rgba(255,255,255,"+(fa*.6)+")");cg.addColorStop(1,"rgba(180,210,255,0)");c.fillStyle=cg;c.beginPath();c.arc(d.flareX,focalY,S*.2*fa,0,TAU);c.fill();c.restore();}
  // cinematic vignette
  if(d.bg!==false){c.save();const vg=c.createRadialGradient(W*.5,H*.5,S*.35,W*.5,H*.5,Math.max(W,H)*.7);vg.addColorStop(0,"rgba(0,0,0,0)");vg.addColorStop(1,"rgba(0,0,0,.55)");c.fillStyle=vg;c.fillRect(0,0,W,H);c.restore();}},
 hud(d){return"STARFALL · 극장판 · "+d.fps+"FPS";}};
})();

/* ════════════════════════════════════════════════════════════════════════
   N45  OBSIDIAN — 궁극기: 시간차 예고 다중 자상 → 정점 대형 슬램
   상태기계: CHARGE(예고 가시 stagger) → SLAM(대형 관통 + 섬광/충격파/파편)
   ════════════════════════════════════════════════════════════════════════ */

  const FXN37=(function(){const TAU=Math.PI*2,clamp=(v,a,b)=>v<a?a:v>b?b:v,rnd=(a,b)=>a+Math.random()*(b-a);
 const P=5,F=44,M=36,eo=x=>1-(1-x)*(1-x);
 const h1=n=>{const s=Math.sin(n)*43758.5453;return s-Math.floor(s);};
 function drawSigil(c,cx,cy,r,life,spin,bw){
  const L=clamp(life,0,1),na=L*.85;
  c.save();c.translate(cx,cy);c.rotate(spin);
  c.strokeStyle=`rgba(255,215,80,${na*.45})`;c.lineWidth=Math.max(.6,bw*.08);
  c.beginPath();c.arc(0,0,r,0,TAU);c.stroke();
  for(let k=0;k<24;k++){const a=k/24*TAU;const t=k%3===0?r*.14:r*.07;c.strokeStyle=`rgba(255,232,120,${na*(k%3===0?.7:.4)})`;c.lineWidth=k%3===0?Math.max(.7,bw*.09):Math.max(.4,bw*.055);c.beginPath();c.moveTo(Math.cos(a)*(r-.5),Math.sin(a)*(r-.5));c.lineTo(Math.cos(a)*(r+t),Math.sin(a)*(r+t));c.stroke();}
  c.rotate(-spin*2.1);
  c.strokeStyle=`rgba(255,228,100,${na*.32})`;c.lineWidth=Math.max(.5,bw*.06);
  c.beginPath();c.arc(0,0,r*.68,0,TAU);c.stroke();
  c.rotate(spin*.3);
  const pts12=[];for(let k=0;k<12;k++){const a=k/12*TAU-Math.PI/2;const rr=k%2===0?r*.62:r*.30;pts12.push([Math.cos(a)*rr,Math.sin(a)*rr]);}
  c.strokeStyle=`rgba(255,220,90,${na*.55})`;c.lineWidth=Math.max(.7,bw*.072);
  c.beginPath();pts12.forEach((p,i)=>{i===0?c.moveTo(p[0],p[1]):c.lineTo(p[0],p[1]);});c.closePath();c.stroke();
  const pts6=[];for(let k=0;k<6;k++){const a=k/6*TAU-Math.PI/2;const rr=k%2===0?r*.36:r*.18;pts6.push([Math.cos(a)*rr,Math.sin(a)*rr]);}
  c.strokeStyle=`rgba(255,245,180,${na*.62})`;c.lineWidth=Math.max(.5,bw*.06);
  c.beginPath();pts6.forEach((p,i)=>{i===0?c.moveTo(p[0],p[1]):c.lineTo(p[0],p[1]);});c.closePath();c.stroke();
  c.strokeStyle=`rgba(255,252,220,${na*.55})`;c.lineWidth=Math.max(.5,bw*.052);
  c.beginPath();c.arc(0,0,r*.18,0,TAU);c.stroke();
  for(let k=0;k<12;k++){const a=k/12*TAU;c.strokeStyle=`rgba(255,225,100,${na*.22})`;c.lineWidth=.5;c.beginPath();c.moveTo(Math.cos(a)*r*.22,Math.sin(a)*r*.22);c.lineTo(Math.cos(a)*r*.6,Math.sin(a)*r*.6);c.stroke();}
  c.restore();}
 return{
 init(d){
  d.pil=[];for(let i=0;i<P;i++)d.pil.push({on:0,x:0,life:0,age:0,ring:0,ringL:0,seed:0,w:1,sigL:0,sigR:0,sigSpin:0});
  d.pi=0;
  d.ftx=new Float32Array(F);d.fty=new Float32Array(F);d.ftv=new Float32Array(F);d.frt=new Float32Array(F);d.fsw=new Float32Array(F);d.fal=new Float32Array(F);for(let i=0;i<F;i++)d.fal[i]=-1;d.fti=0;
  d.mxx=new Float32Array(M);d.myy=new Float32Array(M);d.mw=new Float32Array(M);d.ml=new Float32Array(M);d.mp=new Int8Array(M);for(let i=0;i<M;i++)d.ml[i]=0;d.mi=0;
  d.shake=0;d.auto=1.0;d.spin=0;
  if(!d._castBound){d._castBound=e=>{const r=d.canvas.getBoundingClientRect();this.trigger(d,(e.clientX-r.left)*DPR,(e.clientY-r.top)*DPR);};d.canvas.addEventListener('click',d._castBound);}
  },
 trigger(d,x,y){this.strike(d,x);},
 strike(d,x){
  const slot=d.pi;d.pi=(d.pi+1)%P;const p=d.pil[slot];
  p.on=1;p.x=x;p.life=1;p.age=0;p.ring=0;p.ringL=1;p.seed=Math.random()*43;p.w=.85+Math.random()*.3;
  p.sigL=0;p.sigR=0;p.sigSpin=rnd(0,TAU);
  for(let k=0;k<10;k++){const i=d.fti;d.fti=(d.fti+1)%F;d.fal[i]=1;d.ftx[i]=x+rnd(-60,60);d.fty[i]=rnd(-30,40);d.ftv[i]=rnd(26,60);d.frt[i]=rnd(0,TAU);d.fsw[i]=rnd(.6,1.5);}
  for(let k=0;k<7;k++){const i=d.mi;d.mi=(d.mi+1)%M;d.ml[i]=rnd(.6,1);d.mxx[i]=rnd(-1,1);d.myy[i]=rnd(.05,.7);d.mw[i]=rnd(.4,1);d.mp[i]=slot;}},
 onBurst(d){this.strike(d,d.mOn?d.mx:d.W*.5);},
 frame(d,dt){const c=d.ctx,W=d.W,H=d.H,S=Math.min(W,H);
  if(d.bg===false){c.globalCompositeOperation="destination-out";c.fillStyle="rgba(0,0,0,0.38)";c.fillRect(0,0,W,H);c.globalCompositeOperation="source-over";}else{c.fillStyle='rgba(7,6,3,0.38)';c.fillRect(0,0,W,H);}
  d.spin+=dt;
  if(d.burst>.5){this.strike(d,d.mOn?d.mx:W*.5);d.burst=0;}
  d.auto-=dt;if(d.auto<=0){d.auto=2.6-d.param*1.4;this.strike(d,rnd(W*.16,W*.84));}
  const gy=H*.86;const sh=d.shake*S*.013;d.shake*=Math.pow(.86,dt*60);
  c.save();c.translate(Math.sin(d.t*81)*sh,Math.cos(d.t*64)*sh);
  c.globalCompositeOperation='lighter';
  for(const p of d.pil){if(!p.on)continue;
   p.age+=dt;p.life-=dt*.48;if(p.life<=0){p.on=0;continue;}
   const life=p.life;const drop=clamp(p.age/.09,0,1);
   if(drop>=1&&p.age-dt<.09)d.shake=Math.min(1,d.shake+.85);
   const dropE=eo(drop);const fade=clamp(life/.45,0,1);
   const bw=S*.055*p.w*(0.52+d.param*.62)*(.38+.62*fade);
   const yBot=gy*dropE,x=p.x;const pul=1+.05*Math.sin(d.t*9+p.seed);
   p.sigSpin+=dt*.55;if(drop>=1)p.sigL=Math.min(1,p.sigL+dt*2.8);
   p.sigR=bw*5.2*p.w;
   const ap=c.createRadialGradient(x,0,0,x,0,bw*5);ap.addColorStop(0,`rgba(255,246,210,${.28*fade})`);ap.addColorStop(1,'rgba(255,220,120,0)');c.fillStyle=ap;c.beginPath();c.arc(x,0,bw*5,0,TAU);c.fill();
   const beam=(hw,aMid,col)=>{const g=c.createLinearGradient(x-hw,0,x+hw,0);g.addColorStop(0,`rgba(${col},0)`);g.addColorStop(.18,`rgba(${col},${aMid*.35})`);g.addColorStop(.5,`rgba(${col},${aMid})`);g.addColorStop(.82,`rgba(${col},${aMid*.35})`);g.addColorStop(1,`rgba(${col},0)`);c.fillStyle=g;c.fillRect(x-hw,0,hw*2,yBot);};
   beam(bw*3.2,.10*fade*pul,'255,196,80');beam(bw*1.6,.28*fade,'255,228,130');beam(bw*.52,.76*fade,'255,252,235');
   for(let f2=0;f2<6;f2++){const fo=(h1(p.seed+f2*3.7)-.5)*2;const fx2=x+fo*bw*1.0;const fl=gy*(.18+h1(p.seed+f2*9.1)*.26);const fy=(d.t*(.22+h1(f2+p.seed)*.28)+h1(f2*5+p.seed))%1;const yc=yBot*(1-fy);const g=c.createLinearGradient(0,yc-fl*.5,0,yc+fl*.5);g.addColorStop(0,'rgba(255,250,220,0)');g.addColorStop(.5,`rgba(255,250,220,${.32*fade})`);g.addColorStop(1,'rgba(255,250,220,0)');c.fillStyle=g;c.fillRect(fx2-1.1,Math.max(0,yc-fl*.5),2.2,Math.min(fl,Math.max(1,yBot)));}
   for(let hI=0;hI<4;hI++){const hy=H*(.18+hI*.14),rr=bw*(1.9+hI*.85)*(1+.04*Math.sin(d.t*2+hI));const tilt=Math.sin(d.spin*(hI%2?.68:-.52)+hI*2.1)*.38;const hal=.28*fade*(1-hI*.16);c.save();c.translate(x,hy);c.rotate(tilt);c.strokeStyle=`rgba(255,214,110,${hal*.5})`;c.lineWidth=Math.max(1,bw*.32);c.beginPath();c.ellipse(0,0,rr,rr*.24,0,0,TAU);c.stroke();c.strokeStyle=`rgba(255,242,178,${hal})`;c.lineWidth=Math.max(.5,bw*.09);c.beginPath();c.ellipse(0,0,rr,rr*.24,0,0,TAU);c.stroke();c.restore();}
   c.save();c.translate(x,H*.06);c.rotate(d.spin*.8);
   for(let k=0;k<12;k++){const a=k/12*TAU;const r0=bw*.4,r1=bw*.9;const bf=k%3===0?.55:.28;c.strokeStyle=`rgba(255,220,90,${fade*bf})`;c.lineWidth=k%3===0?Math.max(.8,bw*.08):Math.max(.4,bw*.04);c.beginPath();c.moveTo(Math.cos(a)*r0,Math.sin(a)*r0);c.lineTo(Math.cos(a)*r1,Math.sin(a)*r1);c.stroke();}
   c.strokeStyle=`rgba(255,215,80,${fade*.42})`;c.lineWidth=Math.max(.6,bw*.06);c.beginPath();c.arc(0,0,bw*.6,0,TAU);c.stroke();c.restore();
   const imp=clamp(1-(p.age-.09)*2.2,0,1);
   if(drop>=1&&imp>0){const ig=c.createRadialGradient(x,gy,0,x,gy,bw*8);ig.addColorStop(0,`rgba(255,255,235,${imp*.72})`);ig.addColorStop(.4,`rgba(255,220,110,${imp*.3})`);ig.addColorStop(1,'rgba(255,180,60,0)');c.fillStyle=ig;c.beginPath();c.arc(x,gy,bw*8,0,TAU);c.fill();}
   c.save();c.translate(x,gy);c.scale(1,.3);
   const pool=c.createRadialGradient(0,0,0,0,0,bw*4.5);pool.addColorStop(0,`rgba(255,236,150,${.38*fade})`);pool.addColorStop(1,'rgba(255,190,70,0)');c.fillStyle=pool;c.beginPath();c.arc(0,0,bw*4.5,0,TAU);c.fill();
   if(drop>=1){p.ring+=S*1.1*dt*Math.pow(Math.max(0,p.ringL),.6);p.ringL=Math.max(0,p.ringL-dt*.40);const rL=p.ringL;if(rL>0){c.strokeStyle=`rgba(255,200,90,${rL*.16})`;c.lineWidth=Math.max(1,S*.04*rL);c.beginPath();c.arc(0,0,p.ring,0,TAU);c.stroke();c.strokeStyle=`rgba(255,244,190,${rL*.62})`;c.lineWidth=Math.max(1,S*.007*rL);c.beginPath();c.arc(0,0,p.ring,0,TAU);c.stroke();}}
   c.restore();}
  const active=d._act||(d._act=[]);active.length=0;for(const p of d.pil){if(p.on&&clamp(p.life/.45,0,1)>.2)active.push(p);}
  if(active.length>=2){for(let ai=0;ai<active.length-1;ai++){const pa=active[ai],pb=active[ai+1];const fa=clamp(pa.life/.45,0,1)*clamp(pb.life/.45,0,1);const mx2=(pa.x+pb.x)*.5,my2=gy*.6;c.strokeStyle=`rgba(255,215,80,${fa*.22})`;c.lineWidth=Math.max(.7,S*.005);c.beginPath();c.moveTo(pa.x,gy);c.quadraticCurveTo(mx2,my2,pb.x,gy);c.stroke();}}
  for(let i=0;i<M;i++){if(d.ml[i]<=0)continue;const p=d.pil[d.mp[i]];if(!p||!p.on){d.ml[i]=0;continue;}d.myy[i]+=dt*.16;d.ml[i]-=dt*.38;if(d.myy[i]>.95){d.ml[i]=0;continue;}const fade=clamp(p.life/.45,0,1);const bw=S*.055*p.w*(0.52+d.param*.62);const mx2=p.x+d.mxx[i]*bw*.9,my2=gy*(1-d.myy[i]);const a=clamp(d.ml[i]*fade*(.5+.5*Math.sin(d.t*7+i)),0,1);c.fillStyle=`rgba(255,250,225,${a*.82})`;c.beginPath();c.arc(mx2,my2,1+d.mw[i]*1.6,0,TAU);c.fill();}
  for(let i=0;i<F;i++){if(d.fal[i]<0)continue;d.fty[i]+=d.ftv[i]*dt*.5;d.ftv[i]+=10*dt;d.frt[i]+=dt*d.fsw[i];d.fal[i]-=dt*.32;if(d.fty[i]>H||d.fal[i]<=0){d.fal[i]=-1;continue;}const a=clamp(d.fal[i],0,1);const fx3=d.ftx[i]+Math.sin(d.t*1.3+i)*16;c.save();c.translate(fx3,d.fty[i]);c.rotate(Math.sin(d.frt[i])*.9);const fg=c.createRadialGradient(0,0,0,0,0,9);fg.addColorStop(0,`rgba(255,252,225,${a*.5})`);fg.addColorStop(1,'rgba(255,230,150,0)');c.fillStyle=fg;c.beginPath();c.arc(0,0,9,0,TAU);c.fill();c.fillStyle=`rgba(255,250,215,${a*.8})`;c.beginPath();c.ellipse(0,0,1.8,6.5,0,0,TAU);c.fill();c.restore();}
  c.restore();
  c.save();c.globalCompositeOperation='lighter';
  for(const p of d.pil){if(!p.on||p.sigL<=0)continue;
   const fade=clamp(p.life/.45,0,1);const bw=S*.055*p.w*(0.52+d.param*.62);drawSigil(c,p.x,gy,p.sigR*p.sigL,fade*p.sigL,p.sigSpin,bw);}
  c.restore();},
 hud(d){let n=0;for(const p of d.pil)if(p.on)n++;return"JUDGMENT \u00b7 pillars "+n+" \u00b7 "+d.fps+"FPS";}}
})();

  const FXN38=(function(){const TAU=Math.PI*2,clamp=(v,a,b)=>v<a?a:v>b?b:v,rnd=(a,b)=>a+Math.random()*(b-a);
 const BUB=44, SPL=320, SPORE=160;
 return{
 init(d){
  // floating spore bubbles
  d.bx=new Float32Array(BUB);d.by=new Float32Array(BUB);d.bvx=new Float32Array(BUB);d.bvy=new Float32Array(BUB);d.br=new Float32Array(BUB);d.bw=new Float32Array(BUB);d.bh=new Float32Array(BUB);d.bpop=new Float32Array(BUB);d.bst=new Uint8Array(BUB);for(let i=0;i<BUB;i++)d.bst[i]=0;d.bi=0;
  // splatter rings (pop shockwave)
  d.sx=new Float32Array(SPL);d.sy=new Float32Array(SPL);d.svx=new Float32Array(SPL);d.svy=new Float32Array(SPL);d.sl=new Float32Array(SPL);d.sh=new Float32Array(SPL);for(let i=0;i<SPL;i++)d.sl[i]=0;d.si=0;
  d.auto=0;d.pmx=0;d.pmy=0;},
 _bub(d,x,y,r,hue){const i=d.bi;d.bi=(d.bi+1)%BUB;d.bx[i]=x;d.by[i]=y;d.bvx[i]=rnd(-12,12);d.bvy[i]=rnd(-30,-8);d.br[i]=r;d.bw[i]=rnd(0.7,1.4);d.bh[i]=hue;d.bpop[i]=rnd(1.6,3.2);d.bst[i]=1;},
 _pop(d,x,y,r,hue){const n=Math.floor(8+r/3);for(let k=0;k<n;k++){const i=d.si;d.si=(d.si+1)%SPL;const a=rnd(0,TAU),sp=rnd(60,80)+r*rnd(2,5);d.sx[i]=x;d.sy[i]=y;d.svx[i]=Math.cos(a)*sp;d.svy[i]=Math.sin(a)*sp-rnd(10,40);d.sl[i]=rnd(.5,1);d.sh[i]=hue;}},
 onBurst(d){const W=d.W,H=d.H,S=Math.min(W,H);for(let k=0;k<10;k++)this._bub(d,W*.5+rnd(-S*.2,S*.2),H*.6+rnd(-S*.1,S*.1),rnd(S*.03,S*.07),Math.random()<.5?278:108);},
 frame(d,dt){const c=d.ctx,W=d.W,H=d.H,S=Math.min(W,H);
  c.fillStyle="rgba(5,2,9,0.24)";c.fillRect(0,0,W,H);
  // spawn from drag / auto
  const moved=Math.hypot(d.mx-d.pmx,d.my-d.pmy);d.pmx=d.mx;d.pmy=d.my;
  if(d.mOn&&(moved>4||Math.random()<.12))this._bub(d,d.mx+rnd(-10,10),d.my+rnd(-10,10),rnd(S*.025,S*.06),Math.random()<.5?278:108);
  d.auto-=dt;if(d.auto<=0){d.auto=0.7-d.param*0.4;this._bub(d,rnd(W*.15,W*.85),rnd(H*.5,H*.9),rnd(S*.025,S*.07),Math.random()<.5?278:108);}
  // ── bubbles: rise, wobble, swell → pop ──
  c.save();
  for(let i=0;i<BUB;i++){if(d.bst[i]!==1)continue;d.bvy[i]+=-6*dt;d.bvx[i]+=Math.sin(d.t*2+i)*8*dt;d.bvx[i]*=Math.pow(.99,dt*60);
   d.bx[i]+=d.bvx[i]*dt;d.by[i]+=d.bvy[i]*dt;d.br[i]+=d.bpop[i]*dt*8;d.bpop[i]-=dt;
   if(d.bpop[i]<=0||d.by[i]<-20){if(d.bpop[i]<=0){d.bst[i]=2;this._pop(d,d.bx[i],d.by[i],d.br[i],d.bh[i]);}else d.bst[i]=0;continue;}
   const r=d.br[i],hue=d.bh[i],wob=1+0.06*Math.sin(d.t*8+i);
   // soft toxic membrane
   c.globalCompositeOperation="lighter";
   const g=c.createRadialGradient(d.bx[i]-r*.3,d.by[i]-r*.3,0,d.bx[i],d.by[i],r);
   g.addColorStop(0,hsl(hue,90,70,.28));g.addColorStop(.7,hsl(hue,85,45,.14));g.addColorStop(.92,hsl(hue,100,60,.32));g.addColorStop(1,hsl(hue,100,60,0));
   c.fillStyle=g;c.beginPath();c.arc(d.bx[i],d.by[i],r*wob,0,TAU);c.fill();
   // iridescent rim + specular
   c.strokeStyle=hsl(hue+40,100,75,.4);c.lineWidth=1;c.beginPath();c.arc(d.bx[i],d.by[i],r*wob,0,TAU);c.stroke();
   c.fillStyle="rgba(255,255,255,.5)";c.beginPath();c.arc(d.bx[i]-r*.35,d.by[i]-r*.4,r*.12,0,TAU);c.fill();
   // pre-pop tremor (swelling tell)
   if(d.bpop[i]<0.5){c.strokeStyle=hsl(hue,100,70,(0.5-d.bpop[i])*0.8);c.lineWidth=2;c.beginPath();c.arc(d.bx[i],d.by[i],r*wob*1.05,0,TAU);c.stroke();}}
  c.restore();
  // ── splatter (the 파바방) ──
  c.save();c.globalCompositeOperation="lighter";
  for(let i=0;i<SPL;i++){if(d.sl[i]<=0)continue;d.svy[i]+=300*dt;d.svx[i]*=Math.pow(.95,dt*60);d.sx[i]+=d.svx[i]*dt;d.sy[i]+=d.svy[i]*dt;d.sl[i]-=dt*1.3;const L=clamp(d.sl[i],0,1);
   c.strokeStyle=hsl(d.sh[i],100,65,L*.6);c.lineWidth=1.1;c.beginPath();c.moveTo(d.sx[i],d.sy[i]);c.lineTo(d.sx[i]-d.svx[i]*.02,d.sy[i]-d.svy[i]*.02);c.stroke();
   c.fillStyle=hsl(d.sh[i]+10,100,72,L);c.beginPath();c.arc(d.sx[i],d.sy[i],1+L*2,0,TAU);c.fill();}
  c.restore();},
 hud(d){return"MIASMA · spores · "+d.fps+"FPS";}};
})();

  const FXN39=(function(){const TAU=Math.PI*2,clamp=(v,a,b)=>v<a?a:v>b?b:v,rnd=(a,b)=>a+Math.random()*(b-a);
 const N=480;
 return{
 init(d){d.px=new Float32Array(N);d.py=new Float32Array(N);d.vx=new Float32Array(N);d.vy=new Float32Array(N);d.hue=new Float32Array(N);d.frz=new Float32Array(N);
  const W=d.W||800,H=d.H||440;for(let i=0;i<N;i++){d.px[i]=Math.random()*W;d.py[i]=Math.random()*H;const a=rnd(0,TAU),sp=rnd(28,84);d.vx[i]=Math.cos(a)*sp;d.vy[i]=Math.sin(a)*sp;d.hue[i]=rnd(170,215);d.frz[i]=0;}
  d.sx=0;d.sy=0;d.sr=0;d.on=0;d.prevOn=0;d.autoT=0;d.spin=0;
  if(!d._castBound){d._castBound=e=>{const r=d.canvas.getBoundingClientRect();this.trigger(d,(e.clientX-r.left)*DPR,(e.clientY-r.top)*DPR);};d.canvas.addEventListener('click',d._castBound);}
  },
 trigger(d,x,y){d.on=1;d.sx=x;d.sy=y;d._hold=1.4;},
 onBurst(d){this.trigger(d,d.mOn?d.mx:d.W*.5,d.mOn?d.my:d.H*.5);},
 frame(d,dt){const c=d.ctx,W=d.W,H=d.H,S=Math.min(W,H);
  if(d.bg===false){c.globalCompositeOperation="destination-out";c.fillStyle="rgba(0,0,0,0.30)";c.fillRect(0,0,W,H);c.globalCompositeOperation="source-over";}else{c.fillStyle="rgba(5,6,11,0.30)";c.fillRect(0,0,W,H);}
  d.spin+=dt;
  // field control: burst-hold OR auto-roam
  if(d._hold>0){d._hold-=dt;d.on=1;if(d.mOn){d.sx=d.mx;d.sy=d.my;}}else d.on=0;
  d.autoT-=dt;if(!d.on&&d.autoT<=0){d.autoT=4.5;d._hold=2.2;d.sx=rnd(W*.3,W*.7);d.sy=rnd(H*.3,H*.7);}
  const tr=d.on?S*(.15+d.param*.13):0;d.sr+=(tr-d.sr)*Math.min(1,dt*5);
  const released=d.prevOn&&!d.on;d.prevOn=d.on;const R=d.sr;
  // ── particles: reverse entropy inside, violent release out ──
  c.save();c.globalCompositeOperation="lighter";
  for(let i=0;i<N;i++){const dx=d.px[i]-d.sx,dy=d.py[i]-d.sy,dist=Math.hypot(dx,dy);const inside=R>2&&dist<R;
   if(inside){d.frz[i]=Math.min(1,d.frz[i]+dt*2.0);d.vx[i]*=Math.pow(.15,dt);d.vy[i]*=Math.pow(.15,dt);
    // slow orbital drift (trapped in glitch)
    const a=Math.atan2(dy,dx)+dt*0.3*(1-d.frz[i]);d.px[i]=d.sx+Math.cos(a)*dist;d.py[i]=d.sy+Math.sin(a)*dist;}
   else{if(d.frz[i]>0&&released){const a=Math.atan2(dy,dx),kick=S*2.4*d.frz[i];d.vx[i]=Math.cos(a)*kick;d.vy[i]=Math.sin(a)*kick;}d.frz[i]*=Math.pow(.9,dt*60);}
   d.px[i]+=d.vx[i]*dt;d.py[i]+=d.vy[i]*dt;
   if(d.px[i]<0)d.px[i]+=W;else if(d.px[i]>W)d.px[i]-=W;if(d.py[i]<0)d.py[i]+=H;else if(d.py[i]>H)d.py[i]-=H;
   const f=d.frz[i],hue=d.hue[i]+f*180,li=55+f*28;c.fillStyle=hsl(hue,88,li,.85);const s=1.3+f*1.8;c.beginPath();c.arc(d.px[i],d.py[i],s,0,TAU);c.fill();
   if(f>.5){c.fillStyle="rgba(255,238,180,"+(f*.45)+")";c.fillRect(d.px[i]-s,d.py[i]-.4,s*2,.8);}}
  c.restore();
  if(R<=2)return;
  // ── ornate stasis dome ──
  c.save();c.translate(d.sx,d.sy);c.globalCompositeOperation="lighter";
  // distortion lattice (curved meridians/parallels for a glassy dome)
  c.strokeStyle="rgba(150,190,255,.16)";c.lineWidth=1;
  for(let m=0;m<8;m++){const ph=m/8*Math.PI;c.beginPath();for(let k=0;k<=40;k++){const u=k/40*TAU;const rr=R*Math.abs(Math.cos(ph)*Math.cos(u)+0)*0+R*(0.4+0.6*Math.abs(Math.sin(u+ph)));const x=Math.cos(u)*rr,y=Math.sin(u)*rr*.5;k?c.lineTo(x,y):c.moveTo(x,y);}c.stroke();}
  // body glow
  const g=c.createRadialGradient(0,0,R*.3,0,0,R);g.addColorStop(0,"rgba(255,210,120,.05)");g.addColorStop(.7,"rgba(120,170,255,.10)");g.addColorStop(1,"rgba(190,215,255,.32)");c.fillStyle=g;c.beginPath();c.arc(0,0,R,0,TAU);c.fill();
  // multi concentric clockwork rings (counter-rotating) + tick marks
  const cols=["rgba(255,215,130,","rgba(150,200,255,","rgba(210,235,255,"];
  for(let r=0;r<3;r++){const rr=R*(0.55+r*0.18),sgn=r%2?1:-1,rot=d.spin*sgn*(0.4+r*0.2);
   c.strokeStyle=cols[r]+(0.5)+")";c.lineWidth=1.4;c.beginPath();c.arc(0,0,rr,0,TAU);c.stroke();
   const ticks=24+r*12;for(let t=0;t<ticks;t++){const a=rot+t/ticks*TAU,inr=rr-R*0.03,our=rr+R*0.03*(t%6===0?1.8:1);c.strokeStyle=cols[r]+(t%6===0?.7:.35)+")";c.lineWidth=t%6===0?1.6:.8;c.beginPath();c.moveTo(Math.cos(a)*inr,Math.sin(a)*inr);c.lineTo(Math.cos(a)*our,Math.sin(a)*our);c.stroke();}}
  // floating clockwork runes
  for(let k=0;k<6;k++){const a=d.spin*0.5+k/6*TAU,rr=R*0.38;const x=Math.cos(a)*rr,y=Math.sin(a)*rr;c.save();c.translate(x,y);c.rotate(a);c.strokeStyle="rgba(255,225,150,.6)";c.lineWidth=1;const s=R*0.05;c.strokeRect(-s,-s,s*2,s*2);c.beginPath();c.moveTo(-s,0);c.lineTo(s,0);c.moveTo(0,-s);c.lineTo(0,s);c.stroke();c.restore();}
  // rim
  c.strokeStyle="rgba(255,235,170,.7)";c.lineWidth=2;c.beginPath();c.arc(0,0,R,0,TAU);c.stroke();
  c.restore();},
 hud(d){return"STASIS"+(d.sr>2?" · 시간정지":"")+" · "+d.fps+"FPS";}};
})();



  const FXN41=(function(){const NR=28;return{
 init(d){d.rr=new Float32Array(NR);d.rl=new Float32Array(NR);d.rh=new Float32Array(NR);d.rx=new Float32Array(NR);d.ry=new Float32Array(NR);for(let i=0;i<NR;i++)d.rl[i]=0;d.ri=0;d.auto=0;
  if(!d._castBound){d._castBound=e=>{const r=d.canvas.getBoundingClientRect();this.trigger(d,(e.clientX-r.left)*DPR,(e.clientY-r.top)*DPR);};d.canvas.addEventListener('click',d._castBound);}
  },
 trigger(d,x,y){this.emit(d,x,y);},
 emit(d,x,y){const i=d.ri;d.ri=(d.ri+1)%NR;d.rr[i]=0;d.rl[i]=1;d.rh[i]=Math.random()<.5?185:315;d.rx[i]=x;d.ry[i]=y;},
 frame(d,dt){const c=d.ctx,W=d.W,H=d.H,S=Math.min(W,H);
  if(d.bg===false){c.globalCompositeOperation="destination-out";c.fillStyle="rgba(0,0,0,0.34)";c.fillRect(0,0,W,H);c.globalCompositeOperation="source-over";}else{c.fillStyle="rgba(4,5,12,0.34)";c.fillRect(0,0,W,H);}
  if(d.burst>.5){this.emit(d,d.mOn?d.mx:W*.5,d.mOn?d.my:H*.5);d.burst=0;}
  if(d.mOn&&Math.random()<.12)this.emit(d,d.mx,d.my);
  d.auto-=dt;if(d.auto<=0){d.auto=.6-d.param*.4;this.emit(d,rand(W*.25,W*.75),rand(H*.25,H*.75));}
  c.save();c.globalCompositeOperation="lighter";
  for(let i=0;i<NR;i++){if(d.rl[i]<=0)continue;const spd=S*(1.1+d.param*1.2);d.rr[i]+=spd*dt*(1.4-d.rr[i]/(S))*0+spd*dt*Math.max(.35,1-d.rr[i]/(S*1.1));d.rl[i]-=dt*.5;
   const a=clamp(d.rl[i],0,1);c.strokeStyle=hsl(d.rh[i],100,65,a*.8);c.lineWidth=clamp(a*3.5,.4,3.5);c.beginPath();c.arc(d.rx[i],d.ry[i],d.rr[i],0,TAU);c.stroke();
   c.strokeStyle=hsl(d.rh[i]+10,100,85,a*.4);c.lineWidth=1;c.beginPath();c.arc(d.rx[i],d.ry[i],d.rr[i]*.96,0,TAU);c.stroke();}
  c.restore();},
 hud(d){return"PLASMA · rings · "+d.fps+"FPS";}};
})();

/* ===== N42 ===== ETHEREAL LOTUS CASCADE — 영적 꽃잎 낙하 펄럭임 + 호버 상승 와류 */
const FXN42=(function(){const TAU=Math.PI*2,clamp=(v,a,b)=>v<a?a:v>b?b:v,rnd=(a,b)=>a+Math.random()*(b-a);
 const hsl=(h,s,l,a)=>`hsla(${h},${s}%,${l}%,${a})`;
 const N=150;
 return{
 init(d){d.px=new Float32Array(N);d.py=new Float32Array(N);d.vx=new Float32Array(N);d.vy=new Float32Array(N);
  d.ph=new Float32Array(N);d.sp=new Float32Array(N);d.sz=new Float32Array(N);d.hue=new Float32Array(N);
  d.rot=new Float32Array(N);d.tx=new Float32Array(N);d.ty=new Float32Array(N);
  for(let i=0;i<N;i++)this.spawn(d,i,true);d.vortX=.5;d.vortY=.5;d.vortS=1;d.swirlPhase=0;d._cpx=null;d._cpy=null;
  if(!d._castBound){d._castBound=e=>{const r=d.canvas.getBoundingClientRect();this.trigger(d,(e.clientX-r.left)*DPR,(e.clientY-r.top)*DPR);};d.canvas.addEventListener('click',d._castBound);}
 },
 trigger(d,x,y){d._cpx=x;d._cpy=y;},
 spawn(d,i,any){const W=d.W||800,H=d.H||440;d.px[i]=Math.random()*W;d.py[i]=any?Math.random()*H:-rnd(8,36);
  d.vx[i]=0;d.vy[i]=rnd(14,30);d.ph[i]=rnd(0,TAU);d.sp[i]=rnd(.5,1.4);d.sz[i]=rnd(5,13);
  const r=Math.random();d.hue[i]=r<.5?rnd(315,340):(r<.8?rnd(280,305):190);
  d.rot[i]=rnd(0,TAU);d.tx[i]=d.px[i];d.ty[i]=d.py[i];},
 frame(d,dt){const c=d.ctx,W=d.W,H=d.H,S=Math.min(W,H);
  if(d.bg===false){c.globalCompositeOperation="destination-out";c.fillStyle="rgba(0,0,0,0.26)";c.fillRect(0,0,W,H);c.globalCompositeOperation="source-over";}else{c.fillStyle="rgba(10,6,14,0.26)";c.fillRect(0,0,W,H);}
  d.swirlPhase+=dt*.3;
  if(d.mOn){d.vortX+=(d.mx/W-d.vortX)*Math.min(1,dt*3);d.vortY+=(d.my/H-d.vortY)*Math.min(1,dt*3);d.vortS=1.9;}
  else if(d._cpx!=null){d.vortX+=(d._cpx/W-d.vortX)*Math.min(1,dt*3);d.vortY+=(d._cpy/H-d.vortY)*Math.min(1,dt*3);d.vortS+=(1-d.vortS)*Math.min(1,dt*2);}
  else{d.vortX=.5+Math.cos(d.swirlPhase)*.18;d.vortY=.5+Math.sin(d.swirlPhase*1.3)*.14;d.vortS+=(1-d.vortS)*Math.min(1,dt*2);}
  const vx=d.vortX*W,vy=d.vortY*H,vr=S*(.30+d.param*.12);
  // ── 꽃잎 물리 ──
  c.save();c.globalCompositeOperation="lighter";
  for(let i=0;i<N;i++){d.tx[i]=d.px[i];d.ty[i]=d.py[i];
   const dx=d.px[i]-vx,dy=d.py[i]-vy,dist=Math.hypot(dx,dy)+1;
   if(dist<vr*1.4){
    const f=clamp(1-dist/(vr*1.4),0,1)*d.vortS;
    const tnx=-dy/dist,tny=dx/dist;        // tangential (spin)
    d.vx[i]+=tnx*f*S*2.2*dt;d.vy[i]+=tny*f*S*2.2*dt;
    // inward suction toward core
    const core=clamp(1-dist/(vr*.45),0,1)*f;
    d.vx[i]+=-dx/dist*core*S*0.95*dt;d.vy[i]+=-dy/dist*core*S*0.95*dt;
    // upward loft inside core
    if(dist<vr*.3)d.vy[i]-=S*0.6*core*dt;}
   d.vy[i]+=(18+d.param*15)*dt;
   d.vx[i]*=Math.pow(.92,dt*60);d.vy[i]*=Math.pow(.93,dt*60);
   d.px[i]+=d.vx[i]*dt;d.py[i]+=d.vy[i]*dt;
   const spd=Math.hypot(d.vx[i],d.vy[i]);
   d.rot[i]+=(0.5+spd*0.005)*dt+Math.sin(d.t*d.sp[i]+d.ph[i])*1.6*dt;
   if(d.py[i]>H+24||d.px[i]<-30||d.px[i]>W+30||d.py[i]<-50){this.spawn(d,i,false);continue;}
   const sz=d.sz[i];
   // velocity-aligned elongation (빠를수록 진행방향으로 납작해짐)
   const velAng=spd>6?Math.atan2(d.vy[i],d.vx[i]):d.rot[i];
   const elong=clamp(1+spd*0.004,1,3.4);
   const sk=.42+.58*Math.abs(Math.cos(d.t*d.sp[i]+d.ph[i]));
   c.save();c.translate(d.px[i],d.py[i]);c.rotate(velAng);
   // outer glow
   const ga=c.createRadialGradient(0,0,0,0,0,sz*2.5);
   ga.addColorStop(0,hsl(d.hue[i],95,72,.42));ga.addColorStop(1,hsl(d.hue[i],95,60,0));
   c.fillStyle=ga;c.beginPath();c.arc(0,0,sz*2.5,0,TAU);c.fill();
   // petal body — elongated in velocity direction
   c.fillStyle=hsl(d.hue[i],90,78,.85);
   c.beginPath();c.ellipse(0,0,sz*sk*elong,sz*.9,0,0,TAU);c.fill();
   // hot streak core
   c.fillStyle="rgba(255,255,255,.65)";c.beginPath();c.ellipse(-sz*.2*elong,0,sz*.3*elong,sz*.45,0,0,TAU);c.fill();
   c.restore();}
  c.restore();},
 hud(d){return"LOTUS"+(d.mOn?" · VORTEX":"")+" · "+d.fps+"FPS";}};
})();

  const FXN43=(function(){const TAU=Math.PI*2,clamp=(v,a,b)=>v<a?a:v>b?b:v,rnd=(a,b)=>a+Math.random()*(b-a);
 function sdn(x){x=Math.sin(x*127.1)*43758.5453;return x-Math.floor(x);}
 const N=1100, CLR=24;
 return{
 init(d){d.px=new Float32Array(N);d.py=new Float32Array(N);d.vx=new Float32Array(N);d.vy=new Float32Array(N);d.l=new Float32Array(N);d.k=new Uint8Array(N);d.seed=new Float32Array(N);
  for(let i=0;i<N;i++)this.spawn(d,i,true);
  // "clearings" — negative-space reveals carved into the ash
  d.clx=new Float32Array(CLR);d.cly=new Float32Array(CLR);d.clr=new Float32Array(CLR);d.cll=new Float32Array(CLR);for(let i=0;i<CLR;i++)d.cll[i]=0;d.ci=0;
  d.pmx=0;d.pmy=0;d.auto=0;
  if(!d._castBound){d._castBound=e=>{const r=d.canvas.getBoundingClientRect();this.trigger(d,(e.clientX-r.left)*DPR,(e.clientY-r.top)*DPR);};d.canvas.addEventListener('click',d._castBound);}
  },
 spawn(d,i,any){const W=d.W||800,H=d.H||440;d.px[i]=Math.random()*W;d.py[i]=any?Math.random()*H:H+rnd(0,40);const a=rnd(0,TAU),sp=rnd(8,60);d.vx[i]=Math.cos(a)*sp;d.vy[i]=Math.sin(a)*sp-16;d.l[i]=rnd(.4,1);d.k[i]=Math.random()<.32?1:0;d.seed[i]=Math.random()*99;},
 trigger(d,x,y){this._clear(d,x,y,Math.min(d.W,d.H)*.22);},
 _clear(d,x,y,r){const i=d.ci;d.ci=(d.ci+1)%CLR;d.clx[i]=x;d.cly[i]=y;d.clr[i]=r;d.cll[i]=1;},
 onBurst(d){this.trigger(d,d.mOn?d.mx:d.W*.5,d.mOn?d.my:d.H*.5);},
 frame(d,dt){const c=d.ctx,W=d.W,H=d.H,S=Math.min(W,H);
  // ash backdrop (the good first aesthetic) — soft smoky wash
  if(d.bg===false){c.globalCompositeOperation="destination-out";c.fillStyle="rgba(0,0,0,0.14)";c.fillRect(0,0,W,H);c.globalCompositeOperation="source-over";}else{c.fillStyle="rgba(8,6,5,0.14)";c.fillRect(0,0,W,H);}
  // mouse carves a clearing as it moves (subtractive reveal)
  const moved=Math.hypot(d.mx-d.pmx,d.my-d.pmy);
  if(d.mOn&&moved>3)this._clear(d,d.mx,d.my,S*0.12+moved*0.4);
  d.pmx=d.mx;d.pmy=d.my;
  d.auto-=dt;if(d.auto<=0){d.auto=2.6-d.param*1.2;this._clear(d,rnd(W*.2,W*.8),rnd(H*.3,H*.7),S*rnd(.12,.22));}
  // ── ash + embers ──
  c.save();
  for(let i=0;i<N;i++){const n=sdn(d.seed[i]+d.t*.3)*TAU;d.vx[i]+=Math.cos(n)*20*dt;d.vy[i]+=Math.sin(n)*20*dt-9*dt;d.vx[i]*=Math.pow(.94,dt*60);d.vy[i]*=Math.pow(.94,dt*60);
   d.px[i]+=d.vx[i]*dt;d.py[i]+=d.vy[i]*dt;d.l[i]-=dt*.16;
   if(d.l[i]<=0||d.px[i]<-20||d.px[i]>W+20||d.py[i]<-20||d.py[i]>H+20){this.spawn(d,i,false);continue;}
   // suppress particles inside active clearings (the "subtraction")
   let vis=1;for(let k=0;k<CLR;k++){if(d.cll[k]<=0)continue;const dx=d.px[i]-d.clx[k],dy=d.py[i]-d.cly[k],dd=Math.hypot(dx,dy);const cr=d.clr[k]*clamp(d.cll[k],0,1);if(dd<cr){vis=Math.min(vis,clamp(dd/cr,0,1));}}
   if(vis<=0.04)continue;
   const L=clamp(d.l[i],0,1)*vis;
   if(d.k[i]){c.globalCompositeOperation="lighter";const t=L;c.fillStyle="rgba(255,"+(90+t*120|0)+","+(30+t*40|0)+","+L+")";c.fillRect(d.px[i]-1,d.py[i]-1,2.2,2.2);}
   else{c.globalCompositeOperation="source-over";c.fillStyle="rgba(58,53,50,"+(L*.24)+")";c.beginPath();c.arc(d.px[i],d.py[i],3+(1-d.l[i])*5,0,TAU);c.fill();}}
  c.restore();
  // ── clearing rims: the revealed void glows faintly at its edge (ember-lit) ──
  c.save();c.globalCompositeOperation="lighter";
  for(let k=0;k<CLR;k++){if(d.cll[k]<=0)continue;d.cll[k]-=dt*0.5;const cr=d.clr[k]*clamp(d.cll[k],0,1),L=clamp(d.cll[k],0,1);
   const g=c.createRadialGradient(d.clx[k],d.cly[k],cr*.6,d.clx[k],d.cly[k],cr);g.addColorStop(0,"rgba(0,0,0,0)");g.addColorStop(.85,"rgba(255,130,50,"+(L*.10)+")");g.addColorStop(1,"rgba(255,90,30,0)");c.fillStyle=g;c.beginPath();c.arc(d.clx[k],d.cly[k],cr,0,TAU);c.fill();
   // ember sparks drawn to the rim
   if(Math.random()<L*.5){const a=rnd(0,TAU);c.fillStyle="rgba(255,150,60,"+L+")";c.fillRect(d.clx[k]+Math.cos(a)*cr-1,d.cly[k]+Math.sin(a)*cr-1,2,2);}}
  c.restore();},
 hud(d){return"ASH"+(d.mOn?" · 쓸어냄":"")+" · "+d.fps+"FPS";}};
})();

  const FXN44=(function(){const TAU=Math.PI*2,clamp=(v,a,b)=>v<a?a:v>b?b:v,rnd=(a,b)=>a+Math.random()*(b-a);
 const SEG=260, SHARD=80, LEAK=300, GLITCH=8;
 return{
 init(d){
  d.x0=new Float32Array(SEG);d.y0=new Float32Array(SEG);d.x1=new Float32Array(SEG);d.y1=new Float32Array(SEG);
  d.grow=new Float32Array(SEG);d.gspd=new Float32Array(SEG);d.life=new Float32Array(SEG);d.gen=new Uint8Array(SEG);for(let i=0;i<SEG;i++)d.life[i]=0;d.segi=0;
  d.svx=new Float32Array(SHARD);d.svy=new Float32Array(SHARD);d.scx=new Float32Array(SHARD);d.scy=new Float32Array(SHARD);d.srot=new Float32Array(SHARD);d.svr=new Float32Array(SHARD);d.ssz=new Float32Array(SHARD);d.sl2=new Float32Array(SHARD);d.svz=new Float32Array(SHARD);d.sz=new Float32Array(SHARD);for(let i=0;i<SHARD;i++)d.sl2[i]=0;d.shi=0;
  d.lx=new Float32Array(LEAK);d.ly=new Float32Array(LEAK);d.lvx=new Float32Array(LEAK);d.lvy=new Float32Array(LEAK);d.ll=new Float32Array(LEAK);for(let i=0;i<LEAK;i++)d.ll[i]=0;d.li=0;
  d.glT=new Float32Array(GLITCH);d.glY=new Float32Array(GLITCH);d.glH=new Float32Array(GLITCH);for(let i=0;i<GLITCH;i++)d.glT[i]=0;
  d.voidX=0;d.voidY=0;d.voidR=0;d.voidA=0;d.auto=0;
  if(!d._castBound){d._castBound=e=>{const r=d.canvas.getBoundingClientRect();this.trigger(d,(e.clientX-r.left)*DPR,(e.clientY-r.top)*DPR);};d.canvas.addEventListener('click',d._castBound);}
  },
 _crack(d,x,y,ang,gen,spd){const i=d.segi;d.segi=(d.segi+1)%SEG;const S=Math.min(d.W,d.H);
  const len=rnd(.05,.13)*S*(1-gen*0.12);d.x0[i]=x;d.y0[i]=y;d.x1[i]=x+Math.cos(ang)*len;d.y1[i]=y+Math.sin(ang)*len;
  d.grow[i]=0;d.gspd[i]=spd;d.life[i]=1;d.gen[i]=gen;return i;},
 _shatter(d,cx,cy){const S=Math.min(d.W,d.H);d.voidX=cx;d.voidY=cy;d.voidR=0;d.voidA=1;
  // primary tear: a few long jagged main cracks
  const mains=5+Math.floor(Math.random()*3);
  for(let m=0;m<mains;m++){const a=m/mains*TAU+rnd(-.2,.2);let x=cx,y=cy,ang=a;
   for(let s=0;s<4;s++){const i=this._crack(d,x,y,ang+rnd(-.4,.4),s,rnd(2.5,4));x=d.x1[i];y=d.y1[i];if(Math.random()<.5){const bi=this._crack(d,x,y,ang+rnd(-1.2,1.2),s+1,rnd(2,3.5));}}}
  // peeling shards revealing void
  const ns=10+Math.floor(Math.random()*8);
  for(let k=0;k<ns;k++){const i=d.shi;d.shi=(d.shi+1)%SHARD;const a=rnd(0,TAU),rr=rnd(.02,.14)*S;d.scx[i]=cx+Math.cos(a)*rr;d.scy[i]=cy+Math.sin(a)*rr;const out=rnd(.3,1);d.svx[i]=Math.cos(a)*out*S*0.4;d.svy[i]=Math.sin(a)*out*S*0.4-S*0.1;d.srot[i]=rnd(0,TAU);d.svr[i]=rnd(-4,4);d.ssz[i]=rnd(.04,.12)*S;d.sl2[i]=rnd(.9,1.5);d.sz[i]=0;d.svz[i]=rnd(.3,1.2);}
  // energy leak
  for(let k=0;k<40;k++){const i=d.li;d.li=(d.li+1)%LEAK;const a=rnd(0,TAU),sp=rnd(20,260);d.lx[i]=cx;d.ly[i]=cy;d.lvx[i]=Math.cos(a)*sp;d.lvy[i]=Math.sin(a)*sp;d.ll[i]=rnd(.5,1.2);}
  // glitch slices
  for(let g=0;g<GLITCH;g++){d.glT[g]=rnd(.2,.6);d.glY[g]=cy+rnd(-.2,.2)*d.H;d.glH[g]=rnd(2,14);}},
 trigger(d,x,y){this._shatter(d,x,y);},
 onBurst(d){this.trigger(d,d.mOn?d.mx:d.W*.5,d.mOn?d.my:d.H*.5);},
 frame(d,dt){const c=d.ctx,W=d.W,H=d.H,S=Math.min(W,H);
  // deep space backdrop
  if(d.bg===false){c.clearRect(0,0,W,H);}else{const bg=c.createRadialGradient(W*.5,H*.5,0,W*.5,H*.5,Math.max(W,H)*.75);bg.addColorStop(0,"#0a0814");bg.addColorStop(1,"#040209");c.fillStyle=bg;c.fillRect(0,0,W,H);}
  d.auto-=dt;if(d.auto<=0){d.auto=2.6-d.param*1.3;this._shatter(d,rnd(W*.25,W*.75),rnd(H*.25,H*.75));}
  if(d.mOn&&Math.random()<0.02)this._shatter(d,d.mx,d.my);
  // ── void reveal (the "space behind") under the fracture origin ──
  if(d.voidA>0){d.voidR+=S*1.2*dt;d.voidA-=dt*0.25;const a=clamp(d.voidA,0,1);
   c.save();const vg=c.createRadialGradient(d.voidX,d.voidY,0,d.voidX,d.voidY,d.voidR);
   vg.addColorStop(0,"rgba(0,0,0,"+(a*0.9)+")");vg.addColorStop(.5,"rgba(20,5,40,"+(a*0.6)+")");vg.addColorStop(.85,"rgba(120,40,200,"+(a*0.25)+")");vg.addColorStop(1,"rgba(120,40,200,0)");c.fillStyle=vg;c.beginPath();c.arc(d.voidX,d.voidY,d.voidR,0,TAU);c.fill();
   // distant stars inside void
   c.globalCompositeOperation="lighter";for(let k=0;k<20;k++){const aa=k/20*TAU,rr=d.voidR*(0.2+0.7*((k*0.137)%1));const sx=d.voidX+Math.cos(aa+k)*rr,sy=d.voidY+Math.sin(aa+k)*rr;c.fillStyle="rgba(200,180,255,"+(a*0.5*((k*0.31)%1))+")";c.fillRect(sx,sy,1.5,1.5);}c.restore();}
  // ── peeling shards (lift + perspective shrink + rotate) ──
  c.save();
  for(let i=0;i<SHARD;i++){if(d.sl2[i]<=0)continue;d.svy[i]+=S*0.2*dt;d.scx[i]+=d.svx[i]*dt;d.scy[i]+=d.svy[i]*dt;d.srot[i]+=d.svr[i]*dt;d.sz[i]+=d.svz[i]*dt;d.sl2[i]-=dt*0.55;
   const proj=1/(1+d.sz[i]*0.6),L=clamp(d.sl2[i],0,1),sz=d.ssz[i]*proj;
   c.save();c.translate(d.scx[i],d.scy[i]);c.rotate(d.srot[i]);
   // shard = irregular triangle of "space" with chromatic edge
   c.fillStyle="rgba(12,10,22,"+(L*.85)+")";c.beginPath();c.moveTo(0,-sz);c.lineTo(sz*.8,sz*.6);c.lineTo(-sz*.7,sz*.5);c.closePath();c.fill();
   c.globalCompositeOperation="lighter";
   c.strokeStyle="rgba(80,200,255,"+(L*.5)+")";c.lineWidth=1;c.beginPath();c.moveTo(-1,-sz);c.lineTo(sz*.8-1,sz*.6);c.lineTo(-sz*.7-1,sz*.5);c.closePath();c.stroke();
   c.strokeStyle="rgba(255,60,200,"+(L*.5)+")";c.beginPath();c.moveTo(1,-sz);c.lineTo(sz*.8+1,sz*.6);c.lineTo(-sz*.7+1,sz*.5);c.closePath();c.stroke();
   c.restore();}
  c.restore();
  // ── crack propagation (recursive draw) w/ chromatic aberration ──
  c.save();c.globalCompositeOperation="lighter";c.lineCap="round";
  for(let i=0;i<SEG;i++){if(d.life[i]<=0)continue;d.grow[i]=Math.min(1,d.grow[i]+d.gspd[i]*dt);d.life[i]-=dt*0.3;
   // spawn children when fully grown (bounded by gen)
   if(d.grow[i]>=1&&d.gen[i]<3&&Math.random()<0.04){const ang=Math.atan2(d.y1[i]-d.y0[i],d.x1[i]-d.x0[i]);this._crack(d,d.x1[i],d.y1[i],ang+rnd(-1,1),d.gen[i]+1,rnd(2,3.5));d.grow[i]=1.0001;}
   const ex=d.x0[i]+(d.x1[i]-d.x0[i])*d.grow[i],ey=d.y0[i]+(d.y1[i]-d.y0[i])*d.grow[i];
   const L=clamp(d.life[i],0,1),lw=clamp(L*(d.gen[i]===0?3:2),.5,3);
   // chromatic triple
   c.strokeStyle="rgba(80,210,255,"+(L*.5)+")";c.lineWidth=lw;c.beginPath();c.moveTo(d.x0[i]-1.5,d.y0[i]);c.lineTo(ex-1.5,ey);c.stroke();
   c.strokeStyle="rgba(255,60,200,"+(L*.5)+")";c.beginPath();c.moveTo(d.x0[i]+1.5,d.y0[i]);c.lineTo(ex+1.5,ey);c.stroke();
   c.strokeStyle="rgba(255,255,255,"+L+")";c.lineWidth=lw*.6;c.beginPath();c.moveTo(d.x0[i],d.y0[i]);c.lineTo(ex,ey);c.stroke();
   // leak spark at crack tip
   if(d.grow[i]<1&&Math.random()<.2){const j=d.li;d.li=(d.li+1)%LEAK;d.lx[j]=ex;d.ly[j]=ey;const a=rnd(0,TAU);d.lvx[j]=Math.cos(a)*60;d.lvy[j]=Math.sin(a)*60;d.ll[j]=rnd(.4,.9);}}
  c.lineCap="butt";c.restore();
  // ── energy leak particles ──
  c.save();c.globalCompositeOperation="lighter";
  for(let i=0;i<LEAK;i++){if(d.ll[i]<=0)continue;d.lvx[i]*=Math.pow(.94,dt*60);d.lvy[i]*=Math.pow(.94,dt*60);d.lx[i]+=d.lvx[i]*dt;d.ly[i]+=d.lvy[i]*dt;d.ll[i]-=dt*1.0;const L=clamp(d.ll[i],0,1);c.fillStyle="rgba("+(150+105*L|0)+","+(180+40*L|0)+",255,"+L+")";c.fillRect(d.lx[i]-1,d.ly[i]-1,2.2,2.2);}
  c.restore();
  // ── glitch RGB slices (space instability) ──
  c.save();c.globalCompositeOperation="lighter";
  for(let g=0;g<GLITCH;g++){if(d.glT[g]<=0)continue;d.glT[g]-=dt;const a=clamp(d.glT[g],0,1)*.25;const off=(Math.random()-.5)*S*.04;
   c.fillStyle="rgba(80,220,255,"+a+")";c.fillRect(off-2,d.glY[g],W,d.glH[g]);c.fillStyle="rgba(255,60,200,"+a+")";c.fillRect(-off+2,d.glY[g]+1,W,d.glH[g]);}
  c.restore();},
 hud(d){return"SPATIAL FRACTURE · "+d.fps+"FPS";}};
})();

  const FXN45=(function(){const TAU=Math.PI*2,clamp=(v,a,b)=>v<a?a:v>b?b:v,rnd=(a,b)=>a+Math.random()*(b-a);
 const lerp=(a,b,t)=>a+(b-a)*t;
 const SHARD=48, CRACK=200, RING=8, EMBD=24, DUST=300;
 // 파편 형상: 마름모·육각형·긴 판 혼합
 const SHAPES=[
  [[0,-1.0],[0.45,0],[0,1.0],[-0.45,0]],                    // 마름모
  [[0.5,-0.9],[0.95,0],[0.5,0.9],[-0.5,0.9],[-0.95,0],[-0.5,-0.9]], // 육각형
  [[0.2,-1.4],[0.5,-0.5],[0.4,0.5],[0,-1.4],[-0.4,0.5],[-0.5,-0.5]], // 비대칭 판
  [[0.3,-1.2],[0.6,0.2],[-0.1,1.2],[-0.6,-0.1]],            // 기울어진 평행사변형
 ];
 return{
 init(d){
  // 파편 풀
  d.sx=new Float32Array(SHARD);d.sy=new Float32Array(SHARD);
  d.svx=new Float32Array(SHARD);d.svy=new Float32Array(SHARD);
  d.srot=new Float32Array(SHARD);d.svr=new Float32Array(SHARD);
  d.ssz=new Float32Array(SHARD);d.ssl=new Uint8Array(SHARD);
  d.sshape=new Uint8Array(SHARD);d.shue=new Float32Array(SHARD);
  d.sfade=new Float32Array(SHARD);d.sembedded=new Uint8Array(SHARD);
  d.srefT=new Float32Array(SHARD); // reflection sweep timer
  for(let i=0;i<SHARD;i++)d.ssl[i]=0;d.si=0;
  // 균열 선분 풀
  d.cx=new Float32Array(CRACK);d.cy=new Float32Array(CRACK);
  d.cx2=new Float32Array(CRACK);d.cy2=new Float32Array(CRACK);
  d.cl=new Float32Array(CRACK);for(let i=0;i<CRACK;i++)d.cl[i]=0;d.ci=0;
  // 공허 링
  d.rx=new Float32Array(RING);d.ry=new Float32Array(RING);
  d.rr=new Float32Array(RING);d.rl=new Float32Array(RING);
  for(let i=0;i<RING;i++)d.rl[i]=0;d.ri=0;
  // 박혀있는 파편 (잔류)
  d.ex=new Float32Array(EMBD);d.ey=new Float32Array(EMBD);
  d.erot=new Float32Array(EMBD);d.esz=new Float32Array(EMBD);
  d.el=new Float32Array(EMBD);d.eshape=new Uint8Array(EMBD);
  d.ehue=new Float32Array(EMBD);for(let i=0;i<EMBD;i++)d.el[i]=0;d.ei=0;
  // 분진
  d.dx=new Float32Array(DUST);d.dy=new Float32Array(DUST);
  d.dvx=new Float32Array(DUST);d.dvy=new Float32Array(DUST);
  d.dl=new Float32Array(DUST);for(let i=0;i<DUST;i++)d.dl[i]=0;d.dui=0;
  d.iridT=0;d.auto=0;d.flash=0;d.phase=0;
  if(!d._castBound){d._castBound=e=>{const r=d.canvas.getBoundingClientRect();this.trigger(d,(e.clientX-r.left)*DPR,(e.clientY-r.top)*DPR);};d.canvas.addEventListener('click',d._castBound);}
  },
 _spawnShard(d,tx,ty){
  const i=d.si;d.si=(d.si+1)%SHARD;const S=Math.min(d.W,d.H);
  const spawnX=tx+rnd(-S*.35,S*.35);const spawnY=rnd(-S*.5,-S*.05);
  d.sx[i]=spawnX;d.sy[i]=spawnY;
  const ang=Math.atan2(ty-spawnY,tx-spawnX);
  const spd=rnd(S*0.9,S*1.5);
  d.svx[i]=Math.cos(ang)*spd*0.4+rnd(-spd*.15,spd*.15);
  d.svy[i]=Math.sin(ang)*spd;
  d.srot[i]=rnd(0,TAU);d.svr[i]=rnd(-3.5,3.5);
  // 지수분포 크기: 대부분 작고 일부 거대
  const r1=Math.random(),r2=Math.random();
  d.ssz[i]=S*(0.025+r1*r1*r2*0.18);
  d.ssl[i]=1;d.sshape[i]=Math.floor(Math.random()*SHAPES.length);
  // 팔레트 3종: 0=흑요석기본 1=자주광택 2=보라하이라이트
  d.spalette=d.spalette||new Uint8Array(SHARD);
  d.spalette[i]=Math.random()<.55?0:Math.random()<.6?1:2;
  d.shue[i]=d.spalette[i]===0?270+rnd(-15,15):d.spalette[i]===1?300+rnd(-20,20):260+rnd(-10,10);
  d.sfade[i]=1;d.sembedded[i]=0;d.srefT[i]=Math.random();d.slanded=d.slanded||new Uint8Array(SHARD);d.slanded[i]=0;},
 _impact(d,ix,iy){
  const S=Math.min(d.W,d.H);
  // 공허 링
  const ri=d.ri;d.ri=(d.ri+1)%RING;
  d.rx[ri]=ix;d.ry[ri]=iy;d.rr[ri]=0;d.rl[ri]=1;
  // 균열 방사
  const NC=5+Math.floor(Math.random()*5);
  for(let k=0;k<NC;k++){
   const a=k/NC*TAU+rnd(-.3,.3);const len=rnd(S*.08,S*.22);
   let cx=ix,cy=iy;
   for(let seg=0;seg<3;seg++){
    const ci=d.ci;d.ci=(d.ci+1)%CRACK;
    const nx=cx+Math.cos(a+rnd(-.35,.35))*len/3;
    const ny=cy+Math.sin(a+rnd(-.35,.35))*len/3;
    d.cx[ci]=cx;d.cy[ci]=cy;d.cx2[ci]=nx;d.cy2[ci]=ny;
    d.cl[ci]=rnd(.8,1.4);cx=nx;cy=ny;}}
  // 분진
  for(let k=0;k<18;k++){
   const di=d.dui;d.dui=(d.dui+1)%DUST;
   const a=rnd(0,TAU),sp=rnd(.02,.1)*S;
   d.dx[di]=ix;d.dy[di]=iy;
   d.dvx[di]=Math.cos(a)*sp;d.dvy[di]=Math.sin(a)*sp-rnd(.01,.04)*S;
   d.dl[di]=rnd(.5,1);}
  d.flash=Math.max(d.flash,.6);},
 _embedShard(d,ix,iy,rot,sz,shape,hue){
  const ei=d.ei;d.ei=(d.ei+1)%EMBD;
  d.ex[ei]=ix;d.ey[ei]=iy;d.erot[ei]=rot;
  d.esz[ei]=sz;d.el[ei]=1.8;d.eshape[ei]=shape;d.ehue[ei]=hue;},
 trigger(d,x,y){const S=Math.min(d.W,d.H);for(let k=0;k<5+Math.floor(d.param*6);k++)this._spawnShard(d,x+rnd(-S*.25,S*.25),y);},
 onBurst(d){
  const W=d.W,H=d.H;
  this.trigger(d,d.mOn?d.mx:W*.5,d.mOn?d.my:H*.65);},
 _drawShard(c,pts,sz,cx,cy,rot,iridT,hue,alpha,refT){
  c.save();c.translate(cx,cy);c.rotate(rot);
  const g=c.createLinearGradient(-sz*.5,-sz*.8,sz*.5,sz*.8);
  // 팔레트 분기: hue 270±=흑요석, 300±=자주광택, 260좁=보라하이라이트
  if(hue>=290&&hue<=320){// 자주 광택
   g.addColorStop(0,`rgba(22,4,38,${alpha*.98})`);g.addColorStop(.35,`rgba(55,8,80,${alpha*.88})`);
   g.addColorStop(.65,`rgba(30,5,55,${alpha*.85})`);g.addColorStop(1,`rgba(12,2,22,${alpha*.95})`);}
  else if(hue>=250&&hue<=275){// 보라 하이라이트
   g.addColorStop(0,`rgba(10,4,50,${alpha*.98})`);g.addColorStop(.3,`rgba(30,12,90,${alpha*.88})`);
   g.addColorStop(.6,`rgba(60,20,130,${alpha*.75})`);g.addColorStop(1,`rgba(8,3,40,${alpha*.95})`);}
  else{// 기본 흑요석
   g.addColorStop(0,`rgba(5,2,12,${alpha*.98})`);g.addColorStop(.4,`rgba(14,6,28,${alpha*.9})`);
   g.addColorStop(.7,`rgba(22,10,44,${alpha*.85})`);g.addColorStop(1,`rgba(8,3,18,${alpha*.95})`);}
  c.fillStyle=g;c.beginPath();
  c.moveTo(pts[0][0]*sz,pts[0][1]*sz);
  for(let k=1;k<pts.length;k++)c.lineTo(pts[k][0]*sz,pts[k][1]*sz);
  c.closePath();c.fill();
  const refAngle=refT*TAU*2;const refCos=Math.cos(refAngle);
  if(Math.abs(refCos)>.1){
   const rg=c.createLinearGradient(-sz*refCos,0,sz*refCos,0);
   rg.addColorStop(0,'rgba(255,255,255,0)');rg.addColorStop(.45,'rgba(255,255,255,0)');
   rg.addColorStop(.5,`rgba(200,230,255,${Math.abs(refCos)*alpha*.55})`);
   rg.addColorStop(.55,'rgba(255,255,255,0)');rg.addColorStop(1,'rgba(255,255,255,0)');
   c.fillStyle=rg;c.beginPath();
   c.moveTo(pts[0][0]*sz,pts[0][1]*sz);
   for(let k=1;k<pts.length;k++)c.lineTo(pts[k][0]*sz,pts[k][1]*sz);
   c.closePath();c.fill();}
  const iHue=(iridT*60+hue)%360;
  c.globalCompositeOperation='lighter';
  c.beginPath();c.moveTo(pts[0][0]*sz,pts[0][1]*sz);
  for(let k=1;k<pts.length;k++)c.lineTo(pts[k][0]*sz,pts[k][1]*sz);
  c.closePath();
  c.strokeStyle=`hsla(${iHue},100%,65%,${alpha*.55})`;
  c.lineWidth=1.5;c.shadowBlur=8;c.shadowColor=`hsla(${iHue},100%,75%,1)`;c.stroke();
  c.shadowBlur=0;c.globalCompositeOperation='source-over';
  c.restore();},
 frame(d,dt){
  const c=d.ctx,W=d.W,H=d.H,S=Math.min(W,H);
  d.iridT+=dt*.4;
  if(d.bg===false){c.globalCompositeOperation="destination-out";c.fillStyle="rgba(0,0,0,0.30)";c.fillRect(0,0,W,H);c.globalCompositeOperation="source-over";}else{c.fillStyle='rgba(5,3,10,0.30)';c.fillRect(0,0,W,H);}
  d.auto-=dt;if(d.auto<=0&&d.phase===0){
   d.auto=1.6-d.param*1.0;
   const cx=rnd(.2,.8)*W,cy=rnd(.45,.7)*H;
   for(let k=0;k<2+Math.floor(d.param*3);k++)this._spawnShard(d,cx+rnd(-S*.2,S*.2),cy);}
  if(d.mOn&&Math.random()<.025)this._spawnShard(d,d.mx,d.my+S*.1);
  d.flash*=Math.pow(.88,dt*60);
  // ── 낙하 파편 ──
  for(let i=0;i<SHARD;i++){
   if(!d.ssl[i])continue;
   if(d.sembedded[i]){
    // 박힌 상태: 서서히 페이드
    d.sfade[i]-=dt*0.28;if(d.sfade[i]<=0){d.ssl[i]=0;continue;}
    const pts=SHAPES[d.sshape[i]];
    this._drawShard(c,pts,d.ssz[i],d.sx[i],d.sy[i],d.srot[i],d.iridT,d.shue[i],d.sfade[i]*0.75,d.srefT[i]);
    continue;}
   // 물리
   d.svy[i]+=S*0.9*dt;d.svx[i]*=Math.pow(.98,dt*60);
   d.sx[i]+=d.svx[i]*dt;d.sy[i]+=d.svy[i]*dt;
   d.srot[i]+=d.svr[i]*dt;d.srefT[i]=(d.srefT[i]+dt*0.5)%1;
   // 착탄 판정
   const groundY=H*.88;
   if(d.sy[i]>groundY){
    this._impact(d,d.sx[i],groundY);
    // 착지 충격파 링
    {const ri=d.ri;d.ri=(d.ri+1)%RING;
     d.rx[ri]=d.sx[i];d.ry[ri]=groundY;d.rr[ri]=0;
     d.rl[ri]=d.ssz[i]>0.06*S?1.2:0.7;}
    if(Math.random()<.55){
     d.sembedded[i]=1;d.sy[i]=groundY;d.sfade[i]=1;
     this._embedShard(d,d.sx[i],groundY,d.srot[i],d.ssz[i]*.65,d.sshape[i],d.shue[i]);
    }else{
     for(let k=0;k<8;k++){
      const di=d.dui;d.dui=(d.dui+1)%DUST;
      const a=rnd(-Math.PI,0),sp=rnd(.04,.12)*S;
      d.dx[di]=d.sx[i];d.dy[di]=groundY;
      d.dvx[di]=Math.cos(a)*sp;d.dvy[di]=Math.sin(a)*sp;
      d.dl[di]=rnd(.4,.9);}
     d.ssl[i]=0;}
    continue;}
   if(d.sx[i]<-S*.5||d.sx[i]>W+S*.5||d.sy[i]>H+S*.3){d.ssl[i]=0;continue;}
   // 속도 블러 (모션감)
   const spd=Math.hypot(d.svx[i],d.svy[i]);
   if(spd>S*.5){
    const ux=d.svx[i]/spd,uy=d.svy[i]/spd;
    const blur=Math.min(spd/(S*2),1)*d.ssz[i]*.8;
    c.save();c.globalCompositeOperation='lighter';
    c.strokeStyle=`rgba(80,40,160,${d.sfade[i]*.18})`;c.lineWidth=d.ssz[i]*.6;
    c.beginPath();c.moveTo(d.sx[i]-ux*blur,d.sy[i]-uy*blur);c.lineTo(d.sx[i],d.sy[i]);c.stroke();
    c.restore();}
   const pts=SHAPES[d.sshape[i]];
   this._drawShard(c,pts,d.ssz[i],d.sx[i],d.sy[i],d.srot[i],d.iridT,d.shue[i],d.sfade[i],d.srefT[i]);}
  // ── 잔류 박힌 파편 ──
  for(let i=0;i<EMBD;i++){
   if(d.el[i]<=0)continue;d.el[i]-=dt*0.2;if(d.el[i]<=0)continue;
   const pts=SHAPES[d.eshape[i]];const al=clamp(d.el[i]*.7,0,1);
   this._drawShard(c,pts,d.esz[i],d.ex[i],d.ey[i]+d.esz[i]*.3,d.erot[i],d.iridT,d.ehue[i],al,0);}
  // ── 공허 링 ──
  c.save();c.globalCompositeOperation='lighter';
  for(let i=0;i<RING;i++){
   if(d.rl[i]<=0)continue;d.rr[i]+=S*1.8*dt;d.rl[i]-=dt*(d.rl[i]>0.8?1.1:0.7);
   const al=clamp(d.rl[i],0,1);
   // 착지 충격파: 보라-자주 / 공허 링: 청보라 구분
   const isImpact=d.rl[i]<1&&d.rr[i]<S*.25;
   const rc=isImpact?`rgba(160,80,255,${al*.75})`:`rgba(120,60,220,${al*.65})`;
   const rc2=isImpact?`rgba(255,160,200,${al*.40})`:`rgba(180,120,255,${al*.35})`;
   c.strokeStyle=rc;c.lineWidth=clamp(al*3.5,1,3.5);
   c.shadowBlur=isImpact?16:12;c.shadowColor=isImpact?'rgba(180,60,255,1)':'rgba(100,40,200,1)';
   c.beginPath();c.arc(d.rx[i],d.ry[i],d.rr[i],0,TAU);c.stroke();c.shadowBlur=0;
   c.strokeStyle=rc2;c.lineWidth=1;
   c.beginPath();c.arc(d.rx[i],d.ry[i],d.rr[i]*0.93,0,TAU);c.stroke();}
  c.restore();
  // ── 균열 ──
  c.save();c.globalCompositeOperation='lighter';
  for(let i=0;i<CRACK;i++){
   if(d.cl[i]<=0)continue;d.cl[i]-=dt*0.45;const al=clamp(d.cl[i],0,1);
   c.strokeStyle=`rgba(90,40,180,${al*.55})`;c.lineWidth=clamp(al*2,0.5,2);
   c.shadowBlur=4;c.shadowColor='rgba(80,30,160,.8)';
   c.beginPath();c.moveTo(d.cx[i],d.cy[i]);c.lineTo(d.cx2[i],d.cy2[i]);c.stroke();
   c.strokeStyle=`rgba(200,180,255,${al*.22})`;c.lineWidth=.5;c.shadowBlur=0;
   c.beginPath();c.moveTo(d.cx[i],d.cy[i]);c.lineTo(d.cx2[i],d.cy2[i]);c.stroke();}
  c.restore();
  // ── 분진 ──
  c.save();c.globalCompositeOperation='lighter';
  for(let i=0;i<DUST;i++){
   if(d.dl[i]<=0)continue;
   d.dvy[i]+=S*0.18*dt;d.dvx[i]*=Math.pow(.96,dt*60);
   d.dx[i]+=d.dvx[i]*dt;d.dy[i]+=d.dvy[i]*dt;
   d.dl[i]-=dt*0.8;const L=clamp(d.dl[i],0,1);
   c.fillStyle=`rgba(120,80,200,${L*.5})`;
   c.beginPath();c.arc(d.dx[i],d.dy[i],.8+L*2.2,0,TAU);c.fill();}
  c.restore();
  // ── 플래시 ──
  if(d.flash>0.02){
   c.save();c.globalCompositeOperation='lighter';
   const fg=c.createRadialGradient(W*.5,H*.88,0,W*.5,H*.88,S*.6);
   fg.addColorStop(0,`rgba(120,60,200,${d.flash*.25})`);
   fg.addColorStop(1,'rgba(60,20,100,0)');
   c.fillStyle=fg;c.fillRect(0,0,W,H);c.restore();}},
 hud(d){return'OBSIDIAN · MIRROR DESCENT · '+d.fps+'FPS';}};
})();

/* ════════════════════════════════════════════════════════════════════════
   N44  SPATIAL FRACTURE — 격자 제거, 공간이 깨지고 찢어지는 연출
   재귀 균열 전파 + 색수차 + 파편 박리 → 공허 노출 + 에너지 누출 + 글리치 슬라이스
   ════════════════════════════════════════════════════════════════════════ */

  const FXN51=(function(){const TAU=Math.PI*2,clamp=(v,a,b)=>v<a?a:v>b?b:v,rnd=(a,b)=>a+Math.random()*(b-a);
 const NP=8,NM=8,TRAIL=28,AMB=160;
 const PHUES=[280,300,260,320,240,270,310,250];
 // 삼각형/사각형 궤도 반경 계산 (정n각형 경계)
 function polyR(phi,n){const s=TAU/n,m=((phi%s)+s)%s-s/2;return Math.cos(Math.PI/n)/Math.cos(m);}
 return{
 init(d){
  d.pa=new Float32Array(NP);d.psp=new Float32Array(NP);d.pr=new Float32Array(NP);
  // 쌍 초기화: (0,1)(2,3) → 이중나선, (4,5)(6,7) → 다각형 궤도
  for(let p=0;p<NP;p+=2){
   const r=rnd(.52,1.0),sp=rnd(.38,.82);
   const isH=p<4; // 이중나선 쌍 여부
   d.pa[p]=p/NP*TAU; d.psp[p]=sp; d.pr[p]=r;
   d.pa[p+1]=isH?(d.pa[p]+Math.PI):(d.pa[p]+Math.PI*.6);
   d.psp[p+1]=isH?sp:sp*(Math.random()<.5?1:-1);
   d.pr[p+1]=isH?r:rnd(.52,1.0);}
  d.ma=new Float32Array(NP*NM);d.msp=new Float32Array(NP*NM);d.mr=new Float32Array(NP*NM);
  for(let i=0;i<NP*NM;i++){d.ma[i]=rnd(0,TAU);d.msp[i]=rnd(2.8,6)*(i%2?1:-1);d.mr[i]=rnd(.18,.48);}
  d.mtrail=[];for(let i=0;i<NP*NM;i++)d.mtrail.push({x:new Float32Array(TRAIL),y:new Float32Array(TRAIL),ptr:0,n:0});
  d.ax=new Float32Array(AMB);d.ay=new Float32Array(AMB);d.aang=new Float32Array(AMB);d.asp=new Float32Array(AMB);d.ar2=new Float32Array(AMB);
  d.ambOK=false;d.collapse=0;d.scale=1;d.shock=[];d.skX=0;d.skY=0;d.preW=0;
  if(!d._castBound){d._castBound=e=>{const r=d.canvas.getBoundingClientRect();this.trigger(d,(e.clientX-r.left)*DPR,(e.clientY-r.top)*DPR);};d.canvas.addEventListener('click',d._castBound);}
  },
 trigger(d,x,y){d.tx=x;d.ty=y;},
 _amb(d,cx,cy,S){for(let i=0;i<AMB;i++){const a=Math.random()*TAU,r=S*(.08+Math.random()*.52);d.ax[i]=cx+Math.cos(a)*r;d.ay[i]=cy+Math.sin(a)*r;d.aang[i]=Math.random()*TAU;d.asp[i]=rnd(.15,.65)*(Math.random()<.5?1:-1);d.ar2[i]=rnd(.008,.035);}d.ambOK=true;},
 onBurst(d){d.collapse=1;},
 frame(d,dt){
  const c=d.ctx,W=d.W,H=d.H,S=Math.min(W,H);
  let cx=(d.tx!=null?d.tx:W/2),cy=(d.ty!=null?d.ty:H/2);
  if(!d.ambOK)this._amb(d,cx,cy,S);
  if(d.collapse>0&&d.scale>0.18){d.skX=rnd(-S*.007,S*.007);d.skY=rnd(-S*.007,S*.007);}
  else{d.skX*=0.8;d.skY*=0.8;}
  cx+=d.skX;cy+=d.skY;
  if(d.bg===false){c.globalCompositeOperation="destination-out";c.fillStyle="rgba(0,0,0,0.27)";c.fillRect(0,0,W,H);c.globalCompositeOperation="source-over";}else{c.fillStyle="rgba(4,1,10,0.27)";c.fillRect(0,0,W,H);}
  // 앰비언트 성운
  c.save();c.globalCompositeOperation="lighter";
  for(let i=0;i<AMB;i++){d.aang[i]+=dt*d.asp[i];
   const r2=S*(.08+i/AMB*.5);
   const px=cx+Math.cos(d.aang[i]+d.ar2[i]*d.t*55)*r2,py=cy+Math.sin(d.aang[i]+d.ar2[i]*d.t*55)*r2*.72;
   const a=0.012+0.022*Math.abs(Math.sin(d.t*d.asp[i]+i));
   c.fillStyle="rgba(170,75,255,"+a+")";c.beginPath();c.arc(px,py,.9,0,TAU);c.fill();}
  c.restore();
  const pull=d.collapse>0?2.8:0.07;
  d.scale*=Math.pow(1-pull*0.02,dt*60);
  if(d.collapse===0){d.preW+=dt*.4;const pw=0.035+0.035*Math.abs(Math.sin(d.preW*2.1));
   c.save();c.globalCompositeOperation="lighter";
   const sg=c.createRadialGradient(cx,cy,0,cx,cy,S*.13);
   sg.addColorStop(0,"rgba(220,130,255,"+pw+")");sg.addColorStop(1,"rgba(100,20,200,0)");
   c.fillStyle=sg;c.beginPath();c.arc(cx,cy,S*.13,0,TAU);c.fill();c.restore();}
  if(d.scale<0.10){
   d.scale=1;d.collapse=0;
   d.shock.push({r:0,life:1,type:Math.floor(Math.random()*3)});
   if(d.shock.length>8)d.shock.shift();
   d.skX=rnd(-S*.022,S*.022);d.skY=rnd(-S*.022,S*.022);}
  const baseR=S*0.34*d.scale;
  c.save();c.globalCompositeOperation="lighter";
  // 특이점 코어
  const cR=S*0.05*(2.2-d.scale);
  for(let r=3;r>=0;r--){const rr=cR*(1+r*.65);
   const cg=c.createRadialGradient(cx,cy,0,cx,cy,rr);
   cg.addColorStop(0,"rgba(255,240,255,"+((r===0)?(.38+.55*(1-d.scale)):.07)+")");
   cg.addColorStop(.4,"rgba(200,80,255,"+(0.11*(3-r)/3)+")");
   cg.addColorStop(1,"rgba(110,18,200,0)");
   c.fillStyle=cg;c.beginPath();c.arc(cx,cy,rr,0,TAU);c.fill();}
  for(let r=0;r<3;r++){const ra=S*.028*(1+r*.85)+Math.sin(d.t*4.2+r)*S*.007;
   c.strokeStyle="rgba(235,165,255,"+(0.17-r*.04)+")";c.lineWidth=1.1-r*.28;
   c.beginPath();c.arc(cx,cy,ra,0,TAU);c.stroke();}
  const webDist=S*.22;
  const pX=new Float32Array(NP),pY=new Float32Array(NP);
  for(let p=0;p<NP;p++){
   d.pa[p]+=d.psp[p]*dt*(1+(d.collapse>0?2.5:d.param*1.5));
   const ang=d.pa[p];
   let px_,py_;
   if(p<4){
    // 이중나선: 같은 궤도, π 위상차, 반대 방향 Z 진동 → 나선감
    const helR=baseR*d.pr[p&~1];
    const helZ=Math.sin(ang*1.6)*helR*.13*(p%2===0?1:-1);
    px_=cx+Math.cos(ang)*helR;
    py_=cy+Math.sin(ang)*helR*.83+helZ;
   }else{
    // 다각형 궤도: 삼각(p=4,6) 또는 사각(p=5,7) — 60% 다각, 40% 원
    const n=(p%2===0)?3:4;
    const rfac=1+(polyR(ang,n)-1)*.55;
    const pr=baseR*d.pr[p]*rfac;
    px_=cx+Math.cos(ang)*pr;
    py_=cy+Math.sin(ang)*pr*.83;}
   pX[p]=px_;pY[p]=py_;
   const hue=PHUES[p];
   // 궤도 링 — 이중나선은 점선, 다각형은 직선 세그먼트로 표시
   if(p<4){c.strokeStyle="rgba(190,80,255,"+(0.04*d.scale)+")";c.lineWidth=.7;
    c.setLineDash([3,6]);c.beginPath();c.ellipse(cx,cy,baseR*d.pr[p&~1],baseR*d.pr[p&~1]*.83,0,0,TAU);c.stroke();c.setLineDash([]);}
   else{const n=(p%2===0)?3:4;c.strokeStyle="rgba(190,80,255,"+(0.035*d.scale)+")";c.lineWidth=.65;
    c.beginPath();for(let k=0;k<=n*3;k++){const a=k/(n*3)*TAU;const rf=1+(polyR(a,n)-1)*.55;
     const rx=cx+Math.cos(a)*baseR*d.pr[p]*rf,ry=cy+Math.sin(a)*baseR*d.pr[p]*rf*.83;
     k===0?c.moveTo(rx,ry):c.lineTo(rx,ry);}c.stroke();}
   // 행성 글로우
   const pcr=S*0.025;const pg=c.createRadialGradient(px_,py_,0,px_,py_,pcr*3.2);
   pg.addColorStop(0,"hsla("+hue+",100%,88%,0.92)");pg.addColorStop(.35,"hsla("+hue+",100%,65%,0.38)");pg.addColorStop(1,"hsla("+hue+",100%,40%,0)");
   c.fillStyle=pg;c.beginPath();c.arc(px_,py_,pcr*3.2,0,TAU);c.fill();
   c.fillStyle="hsla("+hue+",60%,92%,0.95)";c.beginPath();c.arc(px_,py_,pcr*.88,0,TAU);c.fill();
   // 에너지 웹
   for(let q=p+1;q<NP;q++){const dist=Math.hypot(pX[p]-pX[q],pY[p]-pY[q]);if(dist>webDist)continue;
    const str=1-dist/webDist;
    const lg=c.createLinearGradient(pX[p],pY[p],pX[q],pY[q]);
    lg.addColorStop(0,"hsla("+hue+",100%,72%,"+(str*.22)+")");lg.addColorStop(.5,"rgba(255,255,255,"+(str*.15)+")");lg.addColorStop(1,"hsla("+PHUES[q]+",100%,72%,"+(str*.22)+")");
    c.strokeStyle=lg;c.lineWidth=str*2.1;c.beginPath();c.moveTo(pX[p],pY[p]);c.lineTo(pX[q],pY[q]);c.stroke();}
   // 위성 (문 트레일 포함)
   for(let m=0;m<NM;m++){const idx=p*NM+m;
    d.ma[idx]+=d.msp[idx]*dt*(1+(d.collapse>0?3.5:1));
    const mr=S*0.052*d.mr[idx]*d.scale*(0.55+0.45*Math.sin(d.t*2.2+idx));
    const mX=px_+Math.cos(d.ma[idx])*mr,mY=py_+Math.sin(d.ma[idx])*mr;
    const tr=d.mtrail[idx];tr.x[tr.ptr]=mX;tr.y[tr.ptr]=mY;tr.ptr=(tr.ptr+1)%TRAIL;if(tr.n<TRAIL)tr.n++;
    if(tr.n>2){c.beginPath();let fi=true;
     for(let k=0;k<tr.n-1;k++){const ki=(tr.ptr-tr.n+k+TRAIL*2)%TRAIL;
      if(fi){c.moveTo(tr.x[ki],tr.y[ki]);fi=false;}else c.lineTo(tr.x[ki],tr.y[ki]);}
     c.strokeStyle="rgba(255,255,255,0.28)";c.lineWidth=.85;c.stroke();}
    c.fillStyle="rgba(255,255,255,0.96)";c.beginPath();c.arc(mX,mY,S*0.0065,0,TAU);c.fill();}}
  // 충격파
  for(let i=d.shock.length-1;i>=0;i--){const s=d.shock[i];
   s.r+=S*2.5*dt;s.life-=dt*0.72;if(s.life<=0){d.shock.splice(i,1);continue;}
   const a=clamp(s.life,0,1);c.shadowBlur=10;
   if(s.type===0){c.strokeStyle="rgba(225,145,255,"+a+")";c.lineWidth=clamp(a*4.5,1,5);c.shadowColor="rgba(195,75,255,"+a+")";
    c.beginPath();for(let k=0;k<=6;k++){const ag=k/6*TAU+d.t*.3;c.lineTo(cx+Math.cos(ag)*s.r,cy+Math.sin(ag)*s.r);}c.closePath();c.stroke();}
   else if(s.type===1){c.strokeStyle="rgba(255,195,255,"+a+")";c.lineWidth=clamp(a*3,1,3);c.shadowColor="rgba(220,115,255,"+a+")";
    c.beginPath();for(let k=0;k<=24;k++){const rr=k%2===0?s.r:s.r*.65;const ag=k/12*TAU+d.t*.2;c.lineTo(cx+Math.cos(ag)*rr,cy+Math.sin(ag)*rr);}c.closePath();c.stroke();}
   else{c.strokeStyle="rgba(255,255,255,"+a*.8+")";c.lineWidth=clamp(a*2,1,2);c.shadowColor="#fff";
    c.beginPath();c.arc(cx,cy,s.r,0,TAU);c.stroke();}
   c.shadowBlur=0;c.strokeStyle="rgba(205,160,255,"+(a*.38)+")";c.lineWidth=1;
   c.beginPath();c.arc(cx,cy,s.r*.93,0,TAU);c.stroke();}
  c.restore();},
 hud(d){return"EPICYCLIC"+(d.collapse>0?" · COLLAPSING":"")+(d.param>.4?" · POLY":"")+" · sc:"+d.scale.toFixed(2)+" · "+d.fps+"FPS";}};
})();

  const FXN52=(function(){const TAU=Math.PI*2,clamp=(v,a,b)=>v<a?a:v>b?b:v,rnd=(a,b)=>a+Math.random()*(b-a);
 const SEG=160,DUST=400,RINGS=6,ARCS=14;
 return{
 init(d){
  d.phase=0;d.dirX=1;d.dirY=0;d.tdx=1;d.tdy=0;
  d.dx=new Float32Array(DUST);d.dy=new Float32Array(DUST);d.dl=new Float32Array(DUST);
  d.dh=new Float32Array(DUST);d.dvx=new Float32Array(DUST);d.dvy=new Float32Array(DUST);d.di=0;
  d.rOff=new Float32Array(RINGS);for(let i=0;i<RINGS;i++)d.rOff[i]=i/RINGS;
  d.surge=0;d.surgeT=0;
  d.arcLife=new Float32Array(ARCS);d.arcAng=new Float32Array(ARCS);d.arcLen=new Float32Array(ARCS);
  if(!d._castBound){d._castBound=e=>{const r=d.canvas.getBoundingClientRect();this.trigger(d,(e.clientX-r.left)*DPR,(e.clientY-r.top)*DPR);};d.canvas.addEventListener('click',d._castBound);}
  },
 trigger(d,x,y){d.tx=x;d.ty=y;},
 onBurst(d){d.surge=1;d.surgeT=0;
  const S=Math.min(d.W,d.H);
  for(let k=0;k<120;k++){const i=d.di;d.di=(d.di+1)%DUST;
   const ang=Math.random()*TAU,spd=rnd(.8,3.5)*S*.0025;
   d.dx[i]=d.W/2;d.dy[i]=d.H/2;d.dl[i]=1;
   d.dvx[i]=Math.cos(ang)*spd;d.dvy[i]=Math.sin(ang)*spd;d.dh[i]=Math.random()<.4?200:Math.random()<.5?180:50;}},
 frame(d,dt){
  const c=d.ctx,W=d.W,H=d.H,cx=(d.tx!=null?d.tx:W/2),cy=(d.ty!=null?d.ty:H/2),S=Math.min(W,H);
  const sg=d.surge*Math.max(0,1-d.surgeT*1.2);
  if(d.surge){d.surgeT+=dt;if(d.surgeT>2)d.surge=0;}
  if(d.bg===false){c.globalCompositeOperation="destination-out";c.fillStyle="rgba(0,0,0,0.31)";c.fillRect(0,0,W,H);c.globalCompositeOperation="source-over";}else{c.fillStyle="rgba(2,4,12,0.31)";c.fillRect(0,0,W,H);}
  d.phase+=dt*(1.0+d.param*2.2);
  if(d.mOn){const ang=Math.atan2(d.my-cy,d.mx-cx);d.tdx=Math.cos(ang);d.tdy=Math.sin(ang);}
  else{const ang=d.t*.28+Math.sin(d.t*.13)*.65;d.tdx=Math.cos(ang);d.tdy=Math.sin(ang);}
  d.dirX+=(d.tdx-d.dirX)*Math.min(1,dt*2.2);d.dirY+=(d.tdy-d.dirY)*Math.min(1,dt*2.2);
  const dl=Math.hypot(d.dirX,d.dirY)||1,ux=d.dirX/dl,uy=d.dirY/dl,pvx=-uy,pvy=ux;
  const len=S*0.72,macR=S*0.105,micR=S*0.038,innR=S*0.055;
  const macT=2.8,micT=24,innT=3.5;
  const proj=(t)=>{const al=(t-.5)*len;const ma=t*macT*TAU-d.phase;
   const mox=Math.cos(ma)*macR+Math.sin(t*TAU*1.3)*macR*.18;
   const moy=Math.sin(ma)*macR*.55+Math.cos(t*TAU*2.1)*macR*.12;
   const dep=0.55+0.45*Math.sin(ma);
   return{x:cx+ux*al+pvx*mox,y:cy+uy*al+pvy*mox+moy,dep,ma};};
  c.save();c.globalCompositeOperation="lighter";
  /* macro helix 3 passes */
  for(let pass=0;pass<3;pass++){
   c.beginPath();for(let s=0;s<=SEG;s++){const P=proj(s/SEG);s===0?c.moveTo(P.x,P.y):c.lineTo(P.x,P.y);}
   if(pass===0){c.lineWidth=macR*.85;c.strokeStyle="rgba(0,80,200,0.35)";}
   else if(pass===1){c.lineWidth=macR*.55;c.strokeStyle="rgba(30,140,255,0.6)";c.shadowBlur=18;c.shadowColor="rgba(60,160,255,.4)";}
   else{c.lineWidth=macR*.18;c.strokeStyle="rgba(180,230,255,0.55)";c.shadowBlur=6;c.shadowColor="#bfe8ff";}
   c.lineCap="round";c.stroke();c.shadowBlur=0;}
  /* secondary magenta coil */
  c.beginPath();let si=false;
  for(let s=0;s<=SEG;s++){const P=proj(s/SEG);const t=s/SEG;
   const ia=t*innT*TAU+d.phase*1.4;
   const ix=pvx*Math.cos(ia)*innR,iy=pvy*Math.cos(ia)*innR+Math.sin(ia)*innR*.45;
   const x2=P.x+ix,y2=P.y+iy;si?(c.lineTo(x2,y2)):(c.moveTo(x2,y2),si=true);}
  c.lineWidth=macR*.16;c.strokeStyle="rgba(255,60,200,0.45)";c.shadowBlur=10;c.shadowColor="#ff3cbb";c.stroke();c.shadowBlur=0;
  /* micro gold helix */
  c.beginPath();let ms=false;
  for(let s=0;s<=SEG*3;s++){const t=s/(SEG*3);const P=proj(t);
   const mi=t*micT*TAU-d.phase*3.2;
   const wx=pvx*Math.cos(mi)*micR,wy=pvy*Math.cos(mi)*micR+Math.sin(mi)*micR*.48;
   const x2=P.x+wx,y2=P.y+wy;ms?(c.lineTo(x2,y2)):(c.moveTo(x2,y2),ms=true);}
  c.lineWidth=1.6;c.strokeStyle="rgba(255,225,120,0.75)";c.shadowBlur=6;c.shadowColor="#ffe078";c.stroke();
  c.lineWidth=.6;c.strokeStyle="rgba(255,255,255,0.45)";c.stroke();c.shadowBlur=0;
  /* sliding energy rings */
  for(let ri=0;ri<RINGS;ri++){
   d.rOff[ri]=(d.rOff[ri]+dt*(.18+ri*.025))%1;
   const P=proj(d.rOff[ri]);const rR=macR*(1.1+.25*Math.sin(d.t*3+ri*1.2));
   const al=clamp(.55+.35*Math.sin(d.t*2.5+ri)+sg*.4,0,1);const hue=180+ri*22;
   c.beginPath();c.arc(P.x,P.y,rR*.55,0,TAU);
   c.strokeStyle="hsla("+hue+",100%,75%,"+al+")";c.lineWidth=1.8;
   c.shadowBlur=14+sg*8;c.shadowColor="hsla("+hue+",100%,80%,1)";c.stroke();c.shadowBlur=0;
   const rg=c.createRadialGradient(P.x,P.y,0,P.x,P.y,rR*.55);
   rg.addColorStop(0,"hsla("+hue+",100%,90%,"+(al*.11)+")");rg.addColorStop(1,"hsla("+hue+",100%,60%,0)");
   c.fillStyle=rg;c.beginPath();c.arc(P.x,P.y,rR*.55,0,TAU);c.fill();}
  /* static discharge arcs */
  for(let ai=0;ai<ARCS;ai++){
   if(d.arcLife[ai]>0)d.arcLife[ai]-=dt*3;
   if(d.arcLife[ai]<=0&&Math.random()<dt*8){d.arcLife[ai]=rnd(.1,.35);d.arcAng[ai]=Math.random()*TAU;d.arcLen[ai]=rnd(macR*.6,macR*2.2);}
   if(d.arcLife[ai]>0){const t=clamp(ai/ARCS,.01,.99);const P=proj(t);const al=d.arcLife[ai];
    let ax=P.x,ay=P.y;c.beginPath();c.moveTo(ax,ay);
    for(let k=0;k<5;k++){ax+=Math.cos(d.arcAng[ai]+rnd(-.8,.8))*d.arcLen[ai]/5;ay+=Math.sin(d.arcAng[ai]+rnd(-.8,.8))*d.arcLen[ai]/5;c.lineTo(ax,ay);}
    c.strokeStyle="rgba(180,230,255,"+clamp(al*.85,0,.8)+")";c.lineWidth=.8;c.shadowBlur=5;c.shadowColor="rgba(100,200,255,"+al+")";c.stroke();c.shadowBlur=0;}}
  /* head node */
  const head=proj(0.99);
  const hB=c.createRadialGradient(head.x,head.y,0,head.x,head.y,macR*(1.8+sg*2));
  hB.addColorStop(0,"rgba(200,240,255,"+(0.35+sg*.5)+")");hB.addColorStop(.4,"rgba(80,160,255,"+(0.12+sg*.2)+")");hB.addColorStop(1,"rgba(0,60,180,0)");
  c.fillStyle=hB;c.beginPath();c.arc(head.x,head.y,macR*(1.8+sg*2),0,TAU);c.fill();
  if(sg>0.1){for(let r=0;r<3;r++){c.strokeStyle="rgba(180,230,255,"+(sg*(1-r*.3)*.7)+")";c.lineWidth=3-r;c.shadowBlur=8;c.shadowColor="#b4e6ff";c.beginPath();c.arc(head.x,head.y,macR*(1.2+r*.5+d.surgeT*S*.06),0,TAU);c.stroke();}c.shadowBlur=0;}
  c.fillStyle="rgba(255,255,255,0.95)";c.shadowBlur=18+sg*12;c.shadowColor="#fff";c.beginPath();c.arc(head.x,head.y,micR*.75,0,TAU);c.fill();c.shadowBlur=0;
  if(Math.random()<.55||sg>.1){const i=d.di;d.di=(d.di+1)%DUST;
   const ang=Math.atan2(uy,ux)+rnd(-.5,.5);const spd=rnd(.4,1.4)*(1+sg*2);
   d.dx[i]=head.x+rnd(-3,3);d.dy[i]=head.y+rnd(-3,3);d.dl[i]=.8+sg*.3;
   d.dvx[i]=Math.cos(ang)*S*spd*.0012;d.dvy[i]=Math.sin(ang)*S*spd*.0012;
   d.dh[i]=Math.random()<.4?198:Math.random()<.5?50:170;}
  c.restore();
  c.save();c.globalCompositeOperation="lighter";
  for(let i=0;i<DUST;i++){if(d.dl[i]<=0)continue;
   d.dl[i]-=dt*(.65-sg*.1);d.dx[i]+=d.dvx[i];d.dy[i]+=d.dvy[i];
   const L=clamp(d.dl[i],0,1);const r=.7+L*2.2;
   c.fillStyle="hsla("+d.dh[i]+",100%,80%,"+L+")";c.shadowBlur=3+L*3;c.shadowColor="hsla("+d.dh[i]+",100%,90%,"+L+")";
   c.beginPath();c.arc(d.dx[i],d.dy[i],r,0,TAU);c.fill();}
  c.shadowBlur=0;c.restore();c.lineCap="butt";},
 hud(d){return"COILED COIL"+(d.mOn?" · STEER":"")+(d.surge?" · SURGE":"")+" · "+d.fps+"FPS";}};
})();

  const MAP={"1":FX1,"2":FX2,"3":FX3,"4":FX4,"5":FX5,"6":FX6,"7":FX7,"8":FX8,"9":FX9,
    "10":FX10,"11":FX11,"12":FX12,"13":FX13,"14":FX14,"15":FX15,"16":FX16,"17":FX17,"19":FX19,"20":FX20,
    "21":FX21,"22":FX22,"23":FX25,"24":FX28,
    "c1":FXc1,"c2":FXc2,"c3":FXc3,"c4":FXc4,"c5":FXc5,"c6":FXc6,
    "25":FX29,"29":FX29,"30":FX30,"INT1":intFX_INT1,"INT2":intFX_INT2,"INT3":intFX_INT3,"INT4":intFX_INT4,"INT5":intFX_INT5,"INT6":intFX_INT6,"INT7":intFX_INT7,"INT8":intFX_INT8,"INT9":intFX_INT9,"INT10":intFX_INT10,"N36":FXN36,"N37":FXN37,"N38":FXN38,"N39":FXN39,"N41":FXN41,"N42":FXN42,"N43":FXN43,"N44":FXN44,"N45":FXN45,"N51":FXN51,"N52":FXN52}; // + FX30 LIQUID TERRAIN
  function initAllCanvases(){
    document.querySelectorAll("canvas[data-fx]").forEach(cv=>{
      const id=cv.getAttribute("data-fx");
      if(id&&id.charAt(0)==="A") return; // PART VIII (ASTRAL) handled by its own isolated engine
      if(demos.find(x=>x.canvas===cv)) return; // already registered
      const d=makeDemo(cv,MAP[id]);
      d.id=id;
      if(!MAP[id]){ console.warn("[VFX] no module for FX#"+id); return; }
      d.hud=document.querySelector('[data-hud="'+id+'"]');
      demos.push(d);
      const tg=document.querySelector('[data-toggle="'+id+'"]');
      if(tg) tg.addEventListener("click",()=>{d.playing=!d.playing;tg.textContent=d.playing?"⏸ 일시정지":"▶ 재생";});
      const br=document.querySelector('[data-burst="'+id+'"]');
      if(br) br.addEventListener("click",()=>{d.burst=1.0;});
      const pr=document.querySelector('[data-param="'+id+'"]');
      if(pr){d.param=pr.value/100;pr.addEventListener("input",()=>{d.param=pr.value/100;});}
      cv.addEventListener("pointermove",e=>{const r=cv.getBoundingClientRect();d.mx=(e.clientX-r.left)*DPR;d.my=(e.clientY-r.top)*DPR;d.mOn=true;});
      cv.addEventListener("pointerleave",()=>{d.mOn=false;});
      io.observe(cv);
    });
  }
  const io=new IntersectionObserver(es=>{es.forEach(e=>{const d=demos.find(x=>x.canvas===e.target);if(d){d.visible=e.isIntersecting;if(d.visible)d.needResize=true;}});},{threshold:0.04});
  let rT=0;
  window.addEventListener("resize",()=>{if(rT)return;rT=requestAnimationFrame(()=>{rT=0;demos.forEach(d=>d.needResize=true);});},{passive:true});
  // Run immediately for canvases already in DOM, then again after full parse
  initAllCanvases();
  document.addEventListener('DOMContentLoaded', initAllCanvases);
})();

/* ═══════════════════════════════════════════════════════════
   PART II — ARCANE CODEX CANVAS SYSTEM
═══════════════════════════════════════════════════════════ */
(function(){
  const dpr=Math.min(devicePixelRatio||1,2);
  const TAU=Math.PI*2;
  const cl=(v,a,b)=>v<a?a:v>b?b:v;
  const eo=(t)=>1-(1-t)*(1-t);
  const rnd=(a,b)=>a+Math.random()*(b-a);
  const ri=(a,b)=>Math.floor(rnd(a,b+1));
  function initAC(canvas){
    const r=canvas.getBoundingClientRect();
    const W=r.width||canvas.parentElement.clientWidth||400;
    const H=r.height||canvas.parentElement.clientHeight||240;
    canvas.width=W*dpr; canvas.height=H*dpr;
    const ctx=canvas.getContext('2d');
    ctx.scale(dpr,dpr);
    return{ctx,W,H};
  }

  function runArcane(canvasId, ovId, btnId, skillFn){
    const canvas=document.getElementById(canvasId);
    const ov=document.getElementById(ovId);
    const btn=document.getElementById(btnId);
    let stopFn=null;

    function activate(x,y){
      if(stopFn){ stopFn(); stopFn=null; }
      if(ov) ov.classList.add('hidden');
      if(btn){ btn.disabled=true; btn.textContent='⏸ 실행 중…'; }
      stopFn=skillFn(canvas,()=>{
        // onDone
        if(btn){ btn.disabled=false; btn.textContent='▶ 실행'; }
        if(ov) ov.classList.remove('hidden');
      }, x, y);
    }
    if(ov) ov.addEventListener('click', e=>{const r=canvas.getBoundingClientRect();activate(e.clientX-r.left,e.clientY-r.top);});
    if(btn) btn.addEventListener('click', ()=>activate());
    canvas._trigger=(x,y)=>activate(x,y); // 게임 연동: canvas._trigger(castX, castY)로 직접 호출 가능 (CSS px 단위)
    new IntersectionObserver(entries=>{
      if(!entries[0].isIntersecting&&stopFn){ stopFn(); stopFn=null; if(btn){btn.disabled=false;btn.textContent='▶ 실행';} if(ov)ov.classList.remove('hidden'); }
    },{threshold:.1}).observe(canvas.parentElement);
  }

  /* ── AC SK1 — QUANTUM FRACTURE ── */
  function sk1(canvas, onDone, castX, castY){
    const{ctx,W,H}=initAC(canvas);
    const cx=castX!=null?castX:W/2, cy=castY!=null?castY:H*.5;
    let raf=null, t=0, blasted=false;
    const parts=[];
    const V=[[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]];
    const E=[[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]];
    function proj(x,y,z,ry,rx,sc){
      const x1=x*Math.cos(ry)-z*Math.sin(ry),z1=x*Math.sin(ry)+z*Math.cos(ry);
      const y2=y*Math.cos(rx)-z1*Math.sin(rx),z2=y*Math.sin(rx)+z1*Math.cos(rx);
      const s=4.5/(4.5+z2*.3); return[cx+x1*sc*s,cy+y2*sc*s];
    }
    function blast(){
      for(let i=0;i<80&&parts.length<200;i++){
        const a=rnd(0,TAU),sp=rnd(3,9);
        parts.push({x:cx+rnd(-14,14),y:cy+rnd(-14,14),vx:Math.cos(a)*sp,vy:Math.sin(a)*sp-rnd(0,3),size:rnd(3,9),rot:rnd(0,TAU),rotS:rnd(-.12,.12),life:1,dec:rnd(.009,.018),grav:rnd(.07,.14),col:['#00ccff','#33aaff','#aaddff'][ri(0,2)],type:'shard'});
      }
      for(let i=0;i<40&&parts.length<200;i++){
        const a=rnd(0,TAU),sp=rnd(5,14);
        parts.push({x:cx,y:cy,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp-rnd(1,4),size:rnd(1,2.5),life:1,dec:rnd(.022,.046),grav:rnd(.05,.1),type:'spark'});
      }
    }
    function frame(){
      ctx.clearRect(0,0,W,H);
      if(t>70&&t<145){const rt=(t-70)/75;ctx.save();ctx.globalAlpha=(1-rt)*.5;ctx.strokeStyle='#0099ff';ctx.lineWidth=3;ctx.shadowBlur=18;ctx.shadowColor='#0066ff';ctx.beginPath();ctx.ellipse(cx,cy+28,rt*155,rt*155*.28,0,0,TAU);ctx.stroke();ctx.restore();}
      if(t>=68&&t<82){ctx.fillStyle=`rgba(0,120,255,${(1-(t-68)/14)*.45})`;ctx.fillRect(0,0,W,H);}
      if(t<80){
        const sc=eo(cl(t/38,0,1))*48, ry=t*.044, rx=.38;
        const glow=t>38?(Math.sin(t*.28)*.5+.5)*.8:0;
        ctx.save();ctx.shadowBlur=8+glow*22;ctx.shadowColor='#00aaff';
        E.forEach(([a,b])=>{
          const[x1,y1]=proj(...V[a],ry,rx,sc),[x2,y2]=proj(...V[b],ry,rx,sc);
          const g=ctx.createLinearGradient(x1,y1,x2,y2);const al=.5+glow*.5;
          g.addColorStop(0,`rgba(0,180,255,${al})`);g.addColorStop(.5,`rgba(200,245,255,${.8+glow*.2})`);g.addColorStop(1,`rgba(0,140,255,${al})`);
          ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.strokeStyle=g;ctx.lineWidth=1.5+glow;ctx.stroke();
        });
        if(t>42){ctx.setLineDash([rnd(1,4),rnd(2,5)]);for(let i=0;i<3;i++){const a=ri(0,7),b=ri(0,7);if(a===b)continue;const[ax,ay]=proj(...V[a],ry,rx,sc),[bx,by]=proj(...V[b],ry,rx,sc);ctx.beginPath();ctx.moveTo(ax,ay);ctx.quadraticCurveTo((ax+bx)/2+rnd(-22,22),(ay+by)/2+rnd(-22,22),bx,by);ctx.strokeStyle=`rgba(160,225,255,${rnd(.4,.9)})`;ctx.lineWidth=rnd(.4,1.8);ctx.shadowBlur=6;ctx.shadowColor='#88ccff';ctx.stroke();}ctx.setLineDash([]);}
        ctx.restore();
        if(t===70&&!blasted){blast();blasted=true;}
      }
      for(let i=parts.length-1;i>=0;i--){
        const p=parts[i];p.x+=p.vx;p.y+=p.vy;p.vy+=p.grav;p.vx*=.975;p.life-=p.dec;
        if(p.type==='shard')p.rot+=p.rotS;
        if(p.life<=0){parts.splice(i,1);continue;}
        ctx.save();ctx.globalAlpha=cl(p.life,0,1);
        if(p.type==='shard'){ctx.translate(p.x,p.y);ctx.rotate(p.rot);ctx.shadowBlur=10;ctx.shadowColor='#0088ff';ctx.fillStyle=p.col;const s=p.size;ctx.beginPath();ctx.moveTo(0,-s);ctx.lineTo(s*.55,s*.18);ctx.lineTo(0,s*.5);ctx.lineTo(-s*.55,s*.18);ctx.closePath();ctx.fill();}
        else{ctx.shadowBlur=6;ctx.shadowColor='#44aaff';ctx.fillStyle='#cceeff';ctx.beginPath();ctx.arc(p.x,p.y,p.size,0,TAU);ctx.fill();}
        ctx.restore();
      }
      t++; if(t<=230||parts.length>0){raf=requestAnimationFrame(frame);}else{raf=null;onDone();}
    }
    raf=requestAnimationFrame(frame);
    return()=>{if(raf){cancelAnimationFrame(raf);raf=null;}ctx.clearRect(0,0,W,H);};
  }

  /* ── AC SK5 — AEGIS LATTICE ── */
  function sk5(canvas, onDone, castX, castY){
    const{ctx,W,H}=initAC(canvas);
    const cx=castX!=null?castX:W/2, cy=castY!=null?castY:H*.46, R=Math.min(W,H)*.32;
    let raf=null, t=0;
    const hexes=[];
    const HS=13, cols=Math.ceil(R/HS)+4, rows=Math.ceil(R/(HS*1.5))+4;
    for(let row=-rows;row<=rows;row++)for(let col=-cols;col<=cols;col++){
      const hx=col*HS*1.732+(row%2===0?0:HS*.866),hy=row*HS*1.5;
      if(Math.sqrt(hx*hx+hy*hy)<R*1.05) hexes.push({x:cx+hx,y:cy+hy,d:Math.sqrt(hx*hx+hy*hy),ph:Math.random()*TAU});
    }
    const orbs=[{a:0,spd:.021,tz:.32,sz:5},{a:TAU/3,spd:.018,tz:-.40,sz:4.5},{a:TAU*2/3,spd:.026,tz:.12,sz:5.5}];
    function hex6(x,y,s){ctx.beginPath();for(let i=0;i<6;i++){const a=i*Math.PI/3-Math.PI/6;i===0?ctx.moveTo(x+Math.cos(a)*s,y+Math.sin(a)*s):ctx.lineTo(x+Math.cos(a)*s,y+Math.sin(a)*s);}ctx.closePath();}
    function frame(){
      ctx.clearRect(0,0,W,H);
      const revP=cl(t/64,0,1),fadeP=cl(1-(t-275)/44,0,1);
      if(fadeP<=0){onDone();return;}
      const sg=ctx.createRadialGradient(cx,cy,0,cx,cy,R);
      sg.addColorStop(0,`rgba(255,150,30,${eo(revP)*.07})`);sg.addColorStop(.65,`rgba(255,120,0,${eo(revP)*.04})`);sg.addColorStop(1,`rgba(255,100,0,${eo(revP)*.08})`);
      ctx.save();ctx.globalAlpha=fadeP;ctx.fillStyle=sg;ctx.beginPath();ctx.arc(cx,cy,R,0,TAU);ctx.fill();ctx.restore();
      ctx.save();ctx.beginPath();ctx.arc(cx,cy,R,0,TAU);ctx.clip();
      hexes.forEach(h=>{
        const nr=h.d/R,hRevP=cl((revP-nr*.46)/.54,0,1);if(hRevP<=0)return;
        const pulse=t>65?(Math.sin(t*.038-nr*3.8+h.ph*.16)*.5+.5):0;
        const ef=1-nr*.52,fill=hRevP*(ef*.07+(pulse>.6?pulse*.15:0)),stroke=hRevP*(ef*.55+pulse*.28);
        const hot=pulse>.72&&t>72;
        hex6(h.x,h.y,HS*.88);
        ctx.fillStyle=hot?`rgba(255,195,65,${fill+.13})`:`rgba(255,140,20,${fill})`;ctx.fill();
        ctx.strokeStyle=hot?`rgba(255,210,85,${stroke+.28})`:`rgba(255,160,40,${stroke*.66})`;ctx.lineWidth=.8;ctx.stroke();
      });
      ctx.restore();
      ctx.save();ctx.globalAlpha=eo(revP)*fadeP;ctx.shadowBlur=28;ctx.shadowColor='#ffaa00';ctx.strokeStyle=`rgba(255,185,65,${eo(revP)*.72})`;ctx.lineWidth=2;ctx.beginPath();ctx.arc(cx,cy,R,0,TAU);ctx.stroke();ctx.restore();
      if(t>64){for(let i=0;i<2;i++){const pt=((t*.017+i*.5)%1),pr=R+pt*50,pa=(1-pt)*.46;ctx.save();ctx.globalAlpha=pa*fadeP;ctx.strokeStyle='#ffaa40';ctx.lineWidth=1.8;ctx.shadowBlur=9;ctx.shadowColor='#ff8800';ctx.beginPath();ctx.arc(cx,cy,pr,0,TAU);ctx.stroke();ctx.restore();}}
      if(t>52){
        const oRevP=cl((t-52)/28,0,1)*fadeP;
        orbs.forEach(o=>{
          o.a+=o.spd;
          const ox=cx+Math.cos(o.a)*R*1.14,oy=cy+Math.sin(o.a)*R*1.14*.42+Math.sin(o.a)*R*o.tz*.3;
          const depth=Math.sin(o.a)*.5+.5,os=o.sz*(.8+depth*.4)*oRevP;
          if(os<=0)return;
          ctx.save();
          for(let j=1;j<=7;j++){const ta=o.a-j*.065,tx=cx+Math.cos(ta)*R*1.14,ty=cy+Math.sin(ta)*R*1.14*.42+Math.sin(ta)*R*o.tz*.3;ctx.globalAlpha=oRevP*(1-j/7)*.32*(.6+depth*.4);ctx.fillStyle='#ffcc66';ctx.beginPath();ctx.arc(tx,ty,os*(1-j/9),0,TAU);ctx.fill();}
          ctx.globalAlpha=oRevP*(.6+depth*.4);ctx.shadowBlur=14;ctx.shadowColor='#ffaa00';
          const og=ctx.createRadialGradient(ox-1,oy-1,0,ox,oy,os);og.addColorStop(0,'#fff5cc');og.addColorStop(.5,'#ffcc44');og.addColorStop(1,'#ff8800');
          ctx.fillStyle=og;ctx.beginPath();ctx.arc(ox,oy,os,0,TAU);ctx.fill();ctx.restore();
        });
      }
      t++; raf=requestAnimationFrame(frame);
    }
    raf=requestAnimationFrame(frame);
    return()=>{if(raf){cancelAnimationFrame(raf);raf=null;}ctx.clearRect(0,0,W,H);};
  }

  runArcane('ac1','acov1','acbtn1', sk1);
  runArcane('ac5','acov5','acbtn5', sk5);
  // ResizeObserver for arcane canvases
  ['ac1','ac5'].forEach(id=>{
    const cvs=document.getElementById(id);
    new ResizeObserver(()=>{ const r=cvs.parentElement.getBoundingClientRect(); cvs.width=r.width*dpr; cvs.height=r.height*dpr; }).observe(cvs.parentElement);
  });
})();

/* ═══════════════════════════════════════════════════════════
   PART III — VFX v64 · quantumFracture DEMO
═══════════════════════════════════════════════════════════ */
(function(){
  const dpr=Math.min(devicePixelRatio||1,2);
  const TAU=Math.PI*2;
  const cl=(v,a,b)=>v<a?a:v>b?b:v;
  const eo=(t)=>1-(1-t)*(1-t);
  const rnd=(a,b)=>a+Math.random()*(b-a);
  let activeRaf=null;

  function run(cvId,duration,drawFn,btns){
    if(activeRaf){cancelAnimationFrame(activeRaf);activeRaf=null;}
    btns.forEach(id=>{ const b=document.getElementById(id); if(b) b.disabled=true; });
    const cvs=document.getElementById(cvId);
    const r=cvs.parentElement.getBoundingClientRect();
    cvs.width=r.width*dpr; cvs.height=r.height*dpr;
    const ctx=cvs.getContext('2d');
    ctx.scale(dpr,dpr);
    const w=r.width, h=r.height, cx=w/2, cy=h/2;
    const s={cvs,ctx,cx,cy,w,h};
    const start=performance.now();
    function tick(){
      const now=performance.now(), elapsed=now-start;
      const p=Math.min(elapsed/duration,1);
      ctx.clearRect(0,0,w,h);
      drawFn(s,p);
      if(p<1){ activeRaf=requestAnimationFrame(tick); }
      else { activeRaf=null; btns.forEach(id=>{ const b=document.getElementById(id); if(b) b.disabled=false; }); }
    }
    activeRaf=requestAnimationFrame(tick);
  }

  window.playQuantum=function(mode){
    const showHex=mode==='cur';
    const nodes=showHex?Array.from({length:6},(_,i)=>({x:0,y:0,a:i/6*TAU})):[];
    const frags=[]; let shattered=false;
    run('v64cv1',2000,(s,p)=>{
      const{ctx,cx,cy,w,h}=s;
      const fade=p<0.78?1:cl(1-(p-0.78)/0.22,0,1);
      nodes.forEach(n=>{n.x=cx+Math.cos(n.a)*w*.85*(1+p*.5);n.y=cy+Math.sin(n.a)*h*.55*(1+p*.4);});
      if(showHex&&p<0.62){
        const gA=cl(p/0.38,0,1)*(1-cl((p-0.52)/0.1,0,1));
        for(let a=0;a<nodes.length;a++)for(let b=a+1;b<nodes.length;b++){
          const lp=cl(p*4-a*.2-b*.1,0,1);if(lp<=0)continue;
          const col=(a+b)%2===0?'#c8c8c8':'#e8d870';
          ctx.save();ctx.globalAlpha=gA*lp*fade;ctx.strokeStyle=col;ctx.lineWidth=1.4;ctx.shadowBlur=8;ctx.shadowColor=col;ctx.beginPath();ctx.moveTo(nodes[a].x,nodes[a].y);ctx.lineTo(nodes[b].x,nodes[b].y);ctx.stroke();ctx.restore();
        }
      }
      if(p>=0.52&&p<0.65){
        const f=(p-0.52)/0.13;
        ctx.save();ctx.globalAlpha=(1-f)*.4*fade;ctx.fillStyle='rgba(220,210,180,.7)';ctx.fillRect(0,0,w,h);ctx.restore();
        if(!shattered){
          const C=['#c8c8d0','#e8e0b0','#fffacc','#aaa8b8'];
          for(let i=0;i<70&&frags.length<100;i++){const a=rnd(0,TAU),sp=rnd(2,8);frags.push({x:cx+rnd(-w*.7,w*.7),y:cy+rnd(-h*.5,h*.5),vx:Math.cos(a)*sp,vy:Math.sin(a)*sp-rnd(0,3),w:rnd(3,13),h:rnd(3,13)*rnd(.25,1.2),rot:rnd(0,TAU),rotS:rnd(-.12,.12),life:1,dec:rnd(.012,.026),grav:rnd(.02,.09),col:C[Math.floor(rnd(0,4))]});}
          shattered=true;
        }
      }
      for(let i=frags.length-1;i>=0;i--){
        const q=frags[i];q.x+=q.vx;q.y+=q.vy;q.vy+=q.grav;q.vx*=.96;q.rot+=q.rotS;q.life-=q.dec;
        if(q.life<=0){frags.splice(i,1);continue;}
        ctx.save();ctx.globalAlpha=q.life*fade;ctx.translate(q.x,q.y);ctx.rotate(q.rot);ctx.shadowBlur=6;ctx.shadowColor=q.col;ctx.fillStyle=q.col+'55';ctx.strokeStyle=q.col;ctx.lineWidth=.8;ctx.beginPath();ctx.rect(-q.w/2,-q.h/2,q.w,q.h);ctx.fill();ctx.stroke();ctx.restore();
      }
    },['v64b1a','v64b1b']);
  };
})();

/* ═══════════════════════════════════════════════════════════
   PART V — SHOWCASE VFX ENGINE v9 · CANVAS REWRITE
═══════════════════════════════════════════════════════════ */
(function(){

const TAU=Math.PI*2, PI=Math.PI;
const rnd=(a,b)=>Math.random()*(b-a)+a;
const clamp=(v,a,b)=>v<a?a:v>b?b:v;
const lerp=(a,b,t)=>a+(b-a)*t;
const dpr=Math.min(2,devicePixelRatio||1);

/* ── canvas init helper ── */
function initCanvas(stage){
  let cv=stage.querySelector('canvas.sc-cv');
  if(!cv){cv=document.createElement('canvas');cv.className='sc-cv';cv.style.cssText='position:absolute;inset:0;width:100%;height:100%;display:block;';stage.appendChild(cv);}
  const r=stage.getBoundingClientRect();
  cv.width=Math.floor(r.width*dpr); cv.height=Math.floor(r.height*dpr);
  const ctx=cv.getContext('2d');
  ctx.scale(dpr,dpr);
  return{cv,ctx,W:r.width,H:r.height,cx:r.width/2,cy:r.height/2};
}

/* ── run canvas loop ── */
function runCanvas(stage,totalMs,drawFn,initFn,castX,castY,bg){
  const{cv,ctx,W,H,cx,cy}=initCanvas(stage);
  const state={W,H,cx:(castX!=null?castX:cx),cy:(castY!=null?castY:cy),t:0,ctx,bg};
  if(initFn) initFn(state);
  let raf=null,start=null;
  function frame(ts){
    if(!start) start=ts;
    const elapsed=ts-start;
    const p=Math.min(elapsed/totalMs,1);
    state.t=elapsed/1000;
    state.p=p;
    drawFn(ctx,state,p);
    if(p<1) raf=requestAnimationFrame(frame);
    else{ ctx.clearRect(0,0,W*dpr,H*dpr); cv.remove(); }
  }
  raf=requestAnimationFrame(frame);
  return ()=>{if(raf)cancelAnimationFrame(raf);cv.remove();};
}

/* ── shared helpers ── */
function glow(ctx,col,blur){ctx.shadowColor=col;ctx.shadowBlur=blur;}
function noGlow(ctx){ctx.shadowBlur=0;}
function arc(ctx,x,y,r){ctx.beginPath();ctx.arc(x,y,r,0,TAU);}
function line(ctx,x0,y0,x1,y1){ctx.beginPath();ctx.moveTo(x0,y0);ctx.lineTo(x1,y1);ctx.stroke();}

/* bolt — recursive lightning */
function drawBolt(ctx,x0,y0,x1,y1,depth,col,alpha){
  if(depth<=0){ctx.globalAlpha=alpha;ctx.strokeStyle=col;ctx.lineWidth=1;line(ctx,x0,y0,x1,y1);ctx.globalAlpha=1;return;}
  const mx=(x0+x1)/2+(Math.random()-.5)*(Math.hypot(x1-x0,y1-y0)*.5),my=(y0+y1)/2+(Math.random()-.5)*(Math.hypot(x1-x0,y1-y0)*.5);
  drawBolt(ctx,x0,y0,mx,my,depth-1,col,alpha);
  drawBolt(ctx,mx,my,x1,y1,depth-1,col,alpha);
  if(Math.random()<.4) drawBolt(ctx,mx,my,mx+(Math.random()-.5)*60,my+(Math.random()-.5)*60,depth-2,col,alpha*.5);
}

const scFns={};

/* ═══════════════════════════════════════════════════════
   SHOWCASE SCENES v9 · CANVAS ENGINE · 5종
   ═══════════════════════════════════════════════════════ */

/* ── SC-01 : 절대영점 붕괴 (나선 수렴 → 다축 동심원 팽창 → 보이드 폭발) ── */
scFns[1]=function(stage,castX,castY,bg){
  const TOTAL=3800;
  return runCanvas(stage,TOTAL,(ctx,s,p)=>{
    const{W,H,cx,cy,t}=s;
    ctx.globalCompositeOperation='source-over';
    if(s.bg===false){ctx.globalCompositeOperation='destination-out';ctx.fillStyle='rgba(0,0,0,0.2)';ctx.fillRect(0,0,W,H);ctx.globalCompositeOperation='source-over';}
    else{ctx.fillStyle=`rgba(2,0,12,0.2)`;ctx.fillRect(0,0,W,H);}
    ctx.globalCompositeOperation='lighter';

    const phase1=clamp(t/0.85,0,1);          // inward spiral
    const phase2=clamp((t-0.7)/1.0,0,1);     // 3D multi-axis rings expanding
    const phase3=clamp((t-1.6)/0.4,0,1);     // void burst
    const fadeOut=clamp((t-3.0)/0.8,0,1);
    const gA=1-fadeOut;

    // ── PHASE 1: 나선 수렴 파티클 (유지) ──
    const numSwirl=90;
    const swirlCollapse=clamp(t/1.0,0,1);
    for(let i=0;i<numSwirl;i++){
      const seed=i/numSwirl;
      const angle=seed*TAU*5+t*(2.5+seed*3.5);
      const radBase=W*0.425*seed;
      const radNow=radBase*(1-swirlCollapse*0.92);
      if(radNow<4) continue;
      const px=cx+Math.cos(angle)*radNow;
      const py=cy+Math.sin(angle)*radNow*0.75;
      const hue=255+seed*65;
      const a=0.75*phase1*(1-clamp(phase2*1.5,0,1))*gA;
      if(a<=0.01) continue;
      ctx.globalAlpha=a;
      glow(ctx,`hsl(${hue},100%,75%)`,7);
      ctx.fillStyle=`hsl(${hue},100%,82%)`;
      arc(ctx,px,py,2.4*(1-seed*.4)*(radNow/radBase));ctx.fill();
      noGlow(ctx);
    }

    // ── PHASE 2: 다축 동심원 — 3D 틸트 회전 + 급속 팽창 ──
    // 각 링은 서로 다른 3D 회전축(tiltX,tiltY)을 가짐
    // canvas 2D에서 3D 효과 = ctx.scale(1, cosθ) + ctx.rotate(φ) 조합으로 시뮬레이션
    if(!s._rings){
      s._rings=[
        // {tiltX°, tiltY°, spinSpd, hue, delay, maxR, waveCount}
        {tx:72, ty: 0,  spd: 1.2, hue:270, del:0.00, mr:1.30, wc:4},
        {tx:20, ty:55,  spd:-1.8, hue:290, del:0.08, mr:1.55, wc:3},
        {tx:55, ty:30,  spd: 2.5, hue:260, del:0.16, mr:1.20, wc:5},
        {tx: 0, ty:70,  spd:-1.1, hue:300, del:0.24, mr:1.45, wc:4},
        {tx:40, ty:80,  spd: 3.0, hue:275, del:0.32, mr:1.60, wc:3},
        {tx:85, ty:15,  spd:-2.2, hue:255, del:0.05, mr:1.35, wc:4},
      ];
    }

    if(phase2>0){
      const p2speed=1-Math.pow(1-phase2,0.6); // fast start, sustain
      s._rings.forEach(rg=>{
        const rp=clamp((phase2-rg.del)/0.85,0,1);if(rp<=0) return;
        const ease=1-Math.pow(1-rp,2);
        const rot=t*rg.spd;
        const cosX=Math.cos(rg.tx*PI/180);
        const cosY=Math.cos(rg.ty*PI/180);
        const rotY=rg.ty*PI/180+t*rg.spd*.3;

        // draw wc expanding wavefronts per ring
        for(let w=0;w<rg.wc;w++){
          const wOffset=w/rg.wc;
          const wP=clamp(ease-wOffset*.25,0,1);if(wP<=0) continue;
          const R=wP*W*0.5*rg.mr;
          const alpha=(1-wP*.6)*(1-fadeOut)*[0.85,0.7,0.55,0.4,0.3][w]*rp;
          if(alpha<=0.02) continue;

          ctx.save();
          ctx.translate(cx,cy);
          // simulate 3D tilt: squish Y by cosX, skew by sinY
          ctx.rotate(rot+w*0.3);
          ctx.scale(1+Math.sin(rotY)*0.25, cosX*(0.28+0.72*Math.abs(cosY)));

          [20,9,2].forEach((blur,li)=>{
            ctx.globalAlpha=[0.18,0.45,0.88][li]*alpha;
            glow(ctx,`hsl(${rg.hue},100%,68%)`,blur);
            ctx.strokeStyle=li===2?`hsl(${rg.hue+15},100%,90%)`:`hsl(${rg.hue},100%,65%)`;
            ctx.lineWidth=[4,2,0.9][li];
            // dashed for inner wavefronts, solid for outermost
            if(w>0) ctx.setLineDash([6+w*2,4]);
            arc(ctx,0,0,R);ctx.stroke();
            ctx.setLineDash([]);
            noGlow(ctx);
          });
          ctx.restore();

          // bright node sparks on each ring at 4 cardinal points
          for(let k=0;k<4;k++){
            const nodeA=k/4*TAU+rot+w*.5;
            const nx=cx+Math.cos(nodeA)*R;
            const ny=cy+Math.sin(nodeA)*R*cosX*(0.3+0.7*Math.abs(cosY));
            const na=alpha*0.8;if(na<=0.02) continue;
            ctx.globalAlpha=na;
            glow(ctx,`hsl(${rg.hue+20},100%,80%)`,12);
            ctx.fillStyle='rgba(255,255,255,0.92)';
            arc(ctx,nx,ny,1.8*(1-wP*.5));ctx.fill();noGlow(ctx);
          }
        }
      });
    }

    // ── PHASE 3: 보이드 코어 폭발 ──
    if(phase3>0){
      if(phase3<0.3){
        ctx.globalCompositeOperation='source-over';
        ctx.globalAlpha=(1-phase3/0.3)*.8*gA;
        ctx.fillStyle='#fff';ctx.fillRect(0,0,W,H);
        ctx.globalCompositeOperation='lighter';
      }
      const burstE=1-Math.pow(1-phase3,2);
      const coreR=burstE*W*0.3;
      const cg=ctx.createRadialGradient(cx,cy,0,cx,cy,coreR);
      cg.addColorStop(0,`rgba(255,255,255,${(1-phase3*.7)*gA})`);
      cg.addColorStop(0.12,`rgba(210,90,255,${(1-phase3*.6)*gA*.85})`);
      cg.addColorStop(0.45,`rgba(90,20,200,${(1-phase3*.4)*gA*.5})`);
      cg.addColorStop(1,'transparent');
      ctx.globalAlpha=1;ctx.fillStyle=cg;arc(ctx,cx,cy,coreR);ctx.fill();

      if(!s._burst){
        s._burst=Array.from({length:130},()=>{
          const a=Math.random()*TAU,sp=rnd(3,10);
          return{a,sp,life:rnd(0.6,1.3),hue:rnd(255,320),sz:rnd(1.5,4.5)};
        });
      }
      const bAge=phase3*1.4;
      s._burst.forEach(pp=>{
        const a=Math.max(0,1-bAge/pp.life)*gA;if(a<=0.01) return;
        ctx.globalAlpha=a;
        glow(ctx,`hsl(${pp.hue},100%,75%)`,9);
        ctx.fillStyle=`hsl(${pp.hue+20},100%,88%)`;
        arc(ctx,cx+Math.cos(pp.a)*pp.sp*bAge*W*.375,
               cy+Math.sin(pp.a)*pp.sp*bAge*H*.375,
               pp.sz*(1-bAge*.5));ctx.fill();noGlow(ctx);
      });
      for(let i=0;i<5;i++){
        const rp=clamp(phase3-i*.07,0,1);if(rp<=0) continue;
        const sa=(1-rp)*0.68*gA;if(sa<.01) continue;
        ctx.globalAlpha=sa;
        ctx.strokeStyle=`hsl(${268+i*18},100%,65%)`;ctx.lineWidth=2.8-i*.35;
        glow(ctx,`hsl(${268+i*18},100%,65%)`,22);
        arc(ctx,cx,cy,rp*W*0.725);ctx.stroke();noGlow(ctx);
      }
    }

    // 중앙 코어 펄스
    const cp=Math.sin(t*9)*.5+.5;
    const ca=clamp(phase1+phase2*.3,0,1)*(1-phase3*1.2)*(1-fadeOut);
    if(ca>0.02){
      ctx.globalAlpha=clamp(ca,0,1);
      glow(ctx,'rgba(195,110,255,1)',28+cp*18);
      ctx.fillStyle='#fff';arc(ctx,cx,cy,7+cp*5);ctx.fill();noGlow(ctx);
    }
    ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';
  },null,castX,castY,bg);
};

/* ── SC-02 : 검기 폭풍 (난방향 나선 칼날 소용돌이 → 바깥 방출) ── */
scFns[2]=function(stage,castX,castY,bg){
  const TOTAL=3800;
  return runCanvas(stage,TOTAL,(ctx,s,p)=>{
    const{W,H,cx,cy,t}=s;
    ctx.globalCompositeOperation='source-over';
    if(s.bg===false){ctx.globalCompositeOperation='destination-out';ctx.fillStyle='rgba(0,0,0,0.21)';ctx.fillRect(0,0,W,H);ctx.globalCompositeOperation='source-over';}
    else{ctx.fillStyle='rgba(0,3,6,0.21)';ctx.fillRect(0,0,W,H);}
    ctx.globalCompositeOperation='lighter';

    const phase1=clamp(t/0.95,0,1);          // blades forming at center
    const phase2=clamp((t-0.6)/0.7,0,1);     // spiraling outward
    const phase3=clamp((t-1.25)/0.45,0,1);   // explosive scatter
    const fadeOut=clamp((t-3.1)/0.7,0,1);
    const gA=1-fadeOut;

    // ── 칼날 정의: 불균형한 각도·속도·궤도 반경으로 개성 부여 ──
    if(!s._blades){
      // 불균형: 각도 간격 불규칙, 속도·크기·색조 제각각
      const angOffsets=[0, 1.15, 1.9, 3.3, 3.85, 5.1, 5.6, 0.55];
      s._blades=angOffsets.map((baseA,i)=>({
        baseA,
        spinSpd: (i%2===0?1:-1)*(1.4+i*0.28+Math.sin(i*1.3)*0.5), // 불균형 회전속도
        orbitR:  rnd(W*.04, W*.11),   // 초기 궤도반경 (중심 근처)
        spreadR: rnd(W*.425, W*.675),  // 최종 도달 반경
        arcLen:  rnd(0.35, 0.95),       // 칼날 호 길이
        hue:     rnd(175,230),
        width:   rnd(1.0, 2.8),
        del:     i*0.055,               // 순차 등장 지연
        curlBias:rnd(-0.4,0.4),         // 나선 틀어짐 편향
        eccentricity: rnd(0.5,0.95),    // 타원 찌그러짐 (Y축 비율)
      }));
    }

    s._blades.forEach((bl,bi)=>{
      const bP=clamp((t-bl.del)/0.65,0,1);if(bP<=0) return;
      const ease=1-Math.pow(1-bP,2.5);

      // 나선 궤도: 시간에 따라 반경 팽창 + 각도 회전
      // 팽창 진행도: phase1→중심 위치, phase2→바깥으로 빠져나감
      const outP=clamp((t-0.6-bl.del)/0.9,0,1);
      const outEase=outP<1?1-Math.pow(1-outP,2.2):1;
      const currentR=lerp(bl.orbitR, bl.spreadR, outEase);

      // 회전각: 나선형 — 반경이 커질수록 회전이 느려짐 (Archimedean)
      const spiralTwist=outEase*TAU*(1.5+bl.curlBias*2); // 나선 꼬임
      const ang=bl.baseA+t*bl.spinSpd*(1-outEase*0.7)+spiralTwist;

      const px=cx+Math.cos(ang)*currentR;
      const py=cy+Math.sin(ang)*currentR*bl.eccentricity;

      // 알파: 바깥으로 나갈수록 점점 사라짐
      const outFade=clamp((outP-0.65)/0.35,0,1);
      const alpha=ease*(1-outFade*0.85)*gA;
      if(alpha<=0.02) return;

      // 잔상 꼬리 (이전 위치들 역추적)
      const tailSteps=8;
      for(let tk=tailSteps;tk>=0;tk--){
        const tailT=t-tk*0.022;
        if(tailT<bl.del) continue;
        const tOut=clamp((tailT-0.6-bl.del)/0.9,0,1);
        const tEase=tOut<1?1-Math.pow(1-tOut,2.2):1;
        const tR=lerp(bl.orbitR,bl.spreadR,tEase);
        const tTwist=tEase*TAU*(1.5+bl.curlBias*2);
        const tAng=bl.baseA+tailT*bl.spinSpd*(1-tEase*0.7)+tTwist;
        const tx2=cx+Math.cos(tAng)*tR;
        const ty2=cy+Math.sin(tAng)*tR*bl.eccentricity;
        const tailA=alpha*(1-tk/tailSteps)*0.45;
        if(tailA<=0.01) continue;
        ctx.globalAlpha=tailA;
        glow(ctx,`hsl(${bl.hue},100%,65%)`,6);
        ctx.fillStyle=`hsl(${bl.hue+15},100%,80%)`;
        arc(ctx,tx2,ty2,bl.width*(1-tk/tailSteps)*(0.4+alpha*.6));
        ctx.fill();noGlow(ctx);
      }

      // 칼날 본체: 호(arc) 3패스 bloom
      [22,9,2].forEach((blur,li)=>{
        const w=[bl.width*3.5, bl.width*1.8, bl.width*0.8][li];
        const a=[0.18,0.45,0.88][li]*alpha;
        if(a<=0.01) return;
        ctx.save();
        ctx.translate(px,py);
        // 칼날 방향: 진행방향에 수직
        const dir=ang+PI/2;
        ctx.rotate(dir);
        ctx.scale(1,bl.eccentricity);
        ctx.globalAlpha=a;
        glow(ctx,`hsl(${bl.hue},100%,68%)`,blur);
        ctx.strokeStyle=li===2?'rgba(255,255,255,0.92)':`hsl(${bl.hue},100%,65%)`;
        ctx.lineWidth=w;
        ctx.beginPath();
        const half=bl.arcLen*currentR*.55;
        ctx.moveTo(-half,0);ctx.lineTo(half,0);
        ctx.stroke();
        noGlow(ctx);ctx.restore();
      });

      // 칼날 끝 광점
      const tipX=cx+Math.cos(ang+bl.arcLen*.5)*currentR;
      const tipY=cy+Math.sin(ang+bl.arcLen*.5)*currentR*bl.eccentricity;
      ctx.globalAlpha=alpha*0.85;
      glow(ctx,`hsl(${bl.hue+25},100%,85%)`,12);
      ctx.fillStyle='rgba(255,255,255,0.9)';
      arc(ctx,tipX,tipY,1.5*ease*(1-outFade));ctx.fill();noGlow(ctx);
    });

    // ── 주변 미세 파티클: 소용돌이 분위기 ──
    const numMicro=55;
    for(let i=0;i<numMicro;i++){
      const seed=i/numMicro;
      const a=seed*TAU*4+t*(1.5+seed*2.2);
      const R=W*0.5*(0.05+seed*.85)*clamp(phase2*1.2,0,1)*(1-clamp(phase3*1.3,0,1));
      if(R<4) continue;
      const mx2=cx+Math.cos(a)*R,my2=cy+Math.sin(a)*R*(0.55+seed*.3);
      const ma=0.4*(1-seed*.5)*gA;if(ma<=0.01) continue;
      ctx.globalAlpha=ma;
      glow(ctx,`hsl(${195+seed*40},100%,75%)`,6);
      ctx.fillStyle=`hsl(${195+seed*40},100%,85%)`;
      arc(ctx,mx2,my2,1.5*(1-seed*.4));ctx.fill();noGlow(ctx);
    }

    // ── PHASE 3: 폭발 종결 — 파편 방출 ──
    if(phase3>0){
      if(phase3<0.2){
        ctx.globalCompositeOperation='source-over';
        ctx.globalAlpha=(1-phase3/0.2)*.6*gA;
        ctx.fillStyle='rgba(200,240,255,1)';ctx.fillRect(0,0,W,H);
        ctx.globalCompositeOperation='lighter';
      }
      if(!s._shards){
        s._shards=Array.from({length:90},()=>{
          const a=Math.random()*TAU,sp=rnd(2,8.5);
          return{vx:Math.cos(a)*sp,vy:Math.sin(a)*sp,life:rnd(0.5,1.4),hue:rnd(180,235),sz:rnd(1,4.5)};
        });
      }
      const sAge=t-1.25;
      s._shards.forEach(pk=>{
        const a=Math.max(0,1-sAge/pk.life)*gA;if(a<=0.01) return;
        ctx.globalAlpha=a*a;
        glow(ctx,`hsl(${pk.hue},100%,70%)`,9);
        ctx.fillStyle=`hsl(${pk.hue+18},100%,84%)`;
        arc(ctx,cx+pk.vx*sAge*50,cy+pk.vy*sAge*50,pk.sz*a);ctx.fill();noGlow(ctx);
      });
    }

    ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';
  },null,castX,castY,bg);
};

/* ── SC-08 : 나선 광자 방출 (수렴 → 임계 → 나선 방출) ── */
scFns[8]=function(stage,castX,castY,bg){
  const TOTAL=3400;
  return runCanvas(stage,TOTAL,(ctx,s,p)=>{
    const{W,H,cx,cy,t}=s;
    ctx.globalCompositeOperation='source-over';
    if(s.bg===false){ctx.globalCompositeOperation='destination-out';ctx.fillStyle='rgba(0,0,0,0.2)';ctx.fillRect(0,0,W,H);ctx.globalCompositeOperation='source-over';}
    else{ctx.fillStyle='rgba(0,2,8,0.2)';ctx.fillRect(0,0,W,H);}
    ctx.globalCompositeOperation='lighter';

    const phase1=clamp(t/1.1,0,1);        // inward spiral charge
    const burstT=1.05;
    const phase2=clamp((t-burstT)/0.25,0,1); // critical burst flash
    const phase3=clamp((t-burstT-.05)/1.2,0,1); // outward spiral emission
    const fadeOut=clamp((t-2.8)/0.55,0,1);
    const gA=1-fadeOut;

    // PHASE 1: 3-layer rotating rings (charge indicator)
    for(let ri=0;ri<3;ri++){
      const rP=clamp((t-ri*0.15)/0.7,0,1);if(rP<=0) continue;
      const ease=1-Math.pow(1-rP,3);
      const R=[W*.26,W*.165,W*.09][ri]*(0.5+ease*.5);
      const rot=t*([1.4,-2.1,3.0][ri]);
      const hue=[190,210,175][ri];
      const al=rP*(1-phase2*.7)*(1-fadeOut)*[0.85,0.7,0.55][ri];
      if(al<=0.02) continue;
      ctx.globalAlpha=al;
      ctx.strokeStyle=`hsl(${hue},100%,65%)`;ctx.lineWidth=[2,1.5,1][ri];
      glow(ctx,`hsl(${hue},100%,65%)`,14+ri*4);
      ctx.setLineDash([5,4]);
      ctx.save();ctx.translate(cx,cy);ctx.rotate(rot);
      arc(ctx,0,0,R);ctx.stroke();
      ctx.restore();ctx.setLineDash([]);noGlow(ctx);
    }

    // PHASE 1: Particles spiraling INWARD
    if(!s._inSpiral){
      s._inSpiral=Array.from({length:160},(_,i)=>{
        const seed=i/160;
        return{
          angle:seed*TAU*6+rnd(0,TAU),
          startR:rnd(W*.35,W*.525),
          spd:rnd(1.5,3.2),
          hue:rnd(175,230),
          sz:rnd(1.2,3.5),
          seed
        };
      });
    }
    s._inSpiral.forEach(pk=>{
      if(phase2>0.6) return;
      const collapseP=phase1*(1-phase2*1.2);
      const r=pk.startR*(1-collapseP*.94);
      if(r<5) return;
      const ang=pk.angle-t*pk.spd;
      const x=cx+Math.cos(ang)*r,y=cy+Math.sin(ang)*r*.6;
      const al=collapseP*(1-phase2)*gA*0.8;if(al<=0.02) return;
      ctx.globalAlpha=al;
      glow(ctx,`hsl(${pk.hue},100%,70%)`,7);
      ctx.fillStyle=`hsl(${pk.hue+15},100%,82%)`;
      arc(ctx,x,y,pk.sz*(r/pk.startR));ctx.fill();noGlow(ctx);
    });

    // Center core build-up
    if(phase1>0.2&&phase2<0.8){
      const cp=Math.sin(t*14)*.5+.5;
      const coreR=4+phase1*14+cp*5;
      const al=phase1*(1-phase2)*gA;
      ctx.globalAlpha=al;
      glow(ctx,'rgba(160,240,255,1)',28+cp*18);
      ctx.fillStyle='rgba(255,255,255,0.95)';
      arc(ctx,cx,cy,coreR);ctx.fill();noGlow(ctx);
    }

    // PHASE 2: Critical flash — white bloom then color
    if(phase2>0){
      ctx.globalCompositeOperation='source-over';
      if(phase2<0.35){
        ctx.globalAlpha=(1-phase2/0.35)*.85*gA;
        ctx.fillStyle='rgba(255,255,255,1)';ctx.fillRect(0,0,W,H);
      }
      if(phase2>0.1&&phase2<0.6){
        const cp2=(phase2-.1)/.5;
        ctx.globalAlpha=(1-cp2)*.45*gA;
        ctx.fillStyle='rgba(100,220,255,1)';ctx.fillRect(0,0,W,H);
      }
      ctx.globalCompositeOperation='lighter';
      // expanding core orb
      const orbR=phase2*W*0.19;
      const og=ctx.createRadialGradient(cx,cy,0,cx,cy,orbR);
      og.addColorStop(0,`rgba(255,255,255,${(1-phase2*.6)*gA})`);
      og.addColorStop(0.2,`rgba(140,230,255,${(1-phase2*.7)*gA*.8})`);
      og.addColorStop(0.6,`rgba(60,180,255,${(1-phase2)*gA*.4})`);
      og.addColorStop(1,'transparent');
      ctx.globalAlpha=1;ctx.fillStyle=og;arc(ctx,cx,cy,orbR);ctx.fill();
    }

    // PHASE 3: Particles spiraling OUTWARD in multiple arms
    if(phase3>0&&!s._outSpiral){
      // 5 spiral arms, each with 30 particles
      s._outSpiral=[];
      const numArms=5;
      for(let arm=0;arm<numArms;arm++){
        const armBase=arm/numArms*TAU;
        for(let i=0;i<32;i++){
          const delay=i*0.018;
          const baseAng=armBase+i*0.28; // arm curvature
          const sp=rnd(2.8,6.5);
          s._outSpiral.push({
            delay,baseAng,sp,
            hue:rnd(175+arm*14,200+arm*14),
            sz:rnd(1.5,4.5),
            life:rnd(0.6,1.3),arm
          });
        }
      }
    }
    if(phase3>0&&s._outSpiral){
      s._outSpiral.forEach(pk=>{
        const age=phase3*(TOTAL/1000-burstT-.05)-pk.delay;
        if(age<=0) return;
        const a=Math.max(0,1-age/pk.life)*gA;if(a<=0.01) return;
        // spiral: radius grows, angle shifts with arm curl
        const r=age*pk.sp*W*.425;
        const ang=pk.baseAng+age*2.8; // outward rotation
        const x=cx+Math.cos(ang)*r,y=cy+Math.sin(ang)*r*.65;
        ctx.globalAlpha=a*a;
        glow(ctx,`hsl(${pk.hue},100%,68%)`,10);
        ctx.fillStyle=`hsl(${pk.hue+20},100%,84%)`;
        arc(ctx,x,y,pk.sz*(0.4+a*.6));ctx.fill();noGlow(ctx);
        // short tail behind
        if(age>0.04){
          const tailAng=pk.baseAng+(age-0.04)*2.8;
          const tr=( age-0.04)*pk.sp*W*.425;
          const tx=cx+Math.cos(tailAng)*tr,ty=cy+Math.sin(tailAng)*tr*.65;
          ctx.globalAlpha=a*.35;
          ctx.strokeStyle=`hsl(${pk.hue},100%,70%)`;ctx.lineWidth=pk.sz*.5;
          glow(ctx,`hsl(${pk.hue},100%,70%)`,6);
          line(ctx,x,y,tx,ty);noGlow(ctx);
        }
      });
      // expanding ring shockwaves
      for(let i=0;i<5;i++){
        const rp=clamp((phase3-i*.06)/.75,0,1);if(rp<=0) continue;
        const sa=(1-rp)*0.6*gA;if(sa<.01) continue;
        ctx.globalAlpha=sa;
        const hue=180+i*16;
        ctx.strokeStyle=`hsl(${hue},100%,65%)`;ctx.lineWidth=2.5-i*.25;
        glow(ctx,`hsl(${hue},100%,65%)`,18);
        arc(ctx,cx,cy,rp*W*0.775);ctx.stroke();noGlow(ctx);
      }
    }

    ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';
  },null,castX,castY,bg);
};

/* ── SC-10 : 천벌 운석군 (5연속 물리 폭격 · 피날레 대폭발) ── */
scFns[10]=function(stage,castX,castY,bg){
  const TOTAL=4200;
  // meteors defined with ratio coords — resolved inside draw using W,H
  const meteorDefs=[
    {t0:0.0,  sxr:-0.06,syr:-0.05,exr:0.30,eyr:0.78,r:11,hue:28},
    {t0:0.38, sxr:1.06, syr:-0.04,exr:0.68,eyr:0.72,r:13,hue:42},
    {t0:0.70, sxr:-0.05,syr:-0.08,exr:0.52,eyr:0.82,r:19,hue:52},
    {t0:0.98, sxr:1.05, syr:-0.05,exr:0.25,eyr:0.74,r:14,hue:34},
    {t0:1.22, sxr:0.50, syr:-0.14,exr:0.50,eyr:0.76,r:28,hue:56},
  ];

  return runCanvas(stage,TOTAL,(ctx,s,p)=>{
    const{W,H,cx,cy,t}=s;
    ctx.globalCompositeOperation='source-over';
    if(s.bg===false){ctx.globalCompositeOperation='destination-out';ctx.fillStyle='rgba(0,0,0,0.22)';ctx.fillRect(0,0,W,H);ctx.globalCompositeOperation='source-over';}
    else{ctx.fillStyle='rgba(2,1,0,0.22)';ctx.fillRect(0,0,W,H);}
    ctx.globalCompositeOperation='lighter';
    const fadeOut=clamp((t-3.5)/0.7,0,1);
    const gA=1-fadeOut;

    if(!s._craters)  s._craters=[];
    if(!s._impParts) s._impParts=[];
    if(!s._shakes)   s._shakes=[];

    meteorDefs.forEach((md,mi)=>{
      const mDur=0.42;
      const mp=clamp((t-md.t0)/mDur,0,1);if(mp<=0) return;
      const sx=md.sxr*W,sy=md.syr*H,ex=cx+(md.exr-0.45)*W,ey=md.eyr*H;
      const mx=lerp(sx,ex,mp),my=lerp(sy,ey,mp);
      const ang=Math.atan2(ey-sy,ex-sx);

      // trail dots
      const trailSteps=22;
      for(let k=1;k<trailSteps;k++){
        const tp=mp-k/trailSteps;if(tp<0) continue;
        const tx=lerp(sx,ex,tp),ty=lerp(sy,ey,tp);
        const ta=(1-k/trailSteps)*(1-Math.max(0,(mp-.94)/.06))*0.75*gA;
        if(ta<0.02) continue;
        const frac=1-k/trailSteps;
        ctx.globalAlpha=ta;
        glow(ctx,`hsl(${md.hue},100%,60%)`,10+k*.4);
        ctx.fillStyle=`hsl(${md.hue+30*frac},100%,${65+25*frac}%)`;
        arc(ctx,tx,ty,md.r*frac*(0.25+ta*.5));ctx.fill();noGlow(ctx);
      }

      // elongated meteor body (rotated)
      if(mp<0.95){
        ctx.save();ctx.translate(mx,my);ctx.rotate(ang);ctx.scale(1.8,1);
        ctx.globalAlpha=gA;
        glow(ctx,`hsl(${md.hue},100%,65%)`,md.r*2);
        const mg=ctx.createRadialGradient(0,0,0,0,0,md.r);
        mg.addColorStop(0,'rgba(255,255,255,1)');
        mg.addColorStop(0.25,`hsl(${md.hue+35},100%,85%)`);
        mg.addColorStop(0.65,`hsl(${md.hue},100%,55%)`);
        mg.addColorStop(1,'transparent');
        ctx.fillStyle=mg;arc(ctx,0,0,md.r*1.6);ctx.fill();
        noGlow(ctx);ctx.restore();
      }

      // impact trigger
      if(mp>0.93&&!s[`imp${mi}`]){
        s[`imp${mi}`]=true;
        s._shakes.push({birth:t,str:mi===4?13:5+mi*1.5});
        const numP=45+mi*28;
        for(let i=0;i<numP;i++){
          const ba=rnd(-PI*.9,-PI*.1),sp=rnd(3.5+mi*.6,10+mi*1.2);
          s._impParts.push({
            x0:ex,y0:ey,vx:Math.cos(ba)*sp,vy:Math.sin(ba)*sp,
            grav:0.1+Math.random()*.12,life:rnd(0.7,1.6),
            sz:rnd(2.5,6+mi),hue:rnd(md.hue-12,md.hue+22),birth:t
          });
        }
        s._craters.push({x:ex,y:ey,r:md.r*1.8,birth:t,hue:md.hue});
      }
    });

    // screen shake
    let shakeX=0,shakeY=0;
    s._shakes.forEach(sk=>{
      const age=t-sk.birth;if(age>0.5) return;
      const str=sk.str*(1-age/0.5);
      shakeX+=(Math.random()-.5)*str;shakeY+=(Math.random()-.5)*str;
    });
    if(shakeX||shakeY){ctx.save();ctx.translate(shakeX,shakeY);}

    // debris particles with gravity
    s._impParts.forEach(pk=>{
      const age=t-pk.birth;
      const a=Math.max(0,1-age/pk.life)*gA;if(a<=0.02) return;
      const x=pk.x0+pk.vx*age*42;
      const y=pk.y0+(pk.vy*age+pk.grav*age*age*35);
      ctx.globalAlpha=a*a;
      glow(ctx,`hsl(${pk.hue},100%,60%)`,10);
      ctx.fillStyle=`hsl(${pk.hue+22},100%,78%)`;
      arc(ctx,x,y,pk.sz*(0.4+a*.6));ctx.fill();noGlow(ctx);
    });

    // crater heat glow
    s._craters.forEach(cr=>{
      const age=t-cr.birth;
      const a=Math.max(0,1-age/2.8)*0.6*gA;if(a<=0.01) return;
      ctx.globalAlpha=a;
      glow(ctx,`hsl(${cr.hue},100%,55%)`,cr.r*1.8);
      const cg=ctx.createRadialGradient(cr.x,cr.y,0,cr.x,cr.y,cr.r*(1.2+age*.4));
      cg.addColorStop(0,`hsla(${cr.hue+40},100%,90%,${a*.5})`);
      cg.addColorStop(0.4,`hsla(${cr.hue},100%,60%,${a*.3})`);
      cg.addColorStop(1,'transparent');
      ctx.fillStyle=cg;arc(ctx,cr.x,cr.y,cr.r*(1.2+age*.4));ctx.fill();noGlow(ctx);
    });

    if(shakeX||shakeY) ctx.restore();

    // FINALE: t>1.65 — ground-level shockwave + debris burst
    if(t>1.65){
      const fAge=t-1.65;
      if(fAge<0.22){
        ctx.globalCompositeOperation='source-over';
        ctx.globalAlpha=(1-fAge/0.22)*.65*gA;
        ctx.fillStyle='rgba(255,200,80,1)';ctx.fillRect(0,0,W,H);
        ctx.globalCompositeOperation='lighter';
      }
      const groundY=H*.77;
      for(let i=0;i<6;i++){
        const rp=clamp((fAge-i*.06)/.85,0,1);if(rp<=0) continue;
        const sa=(1-rp)*0.6*gA;if(sa<.01) continue;
        ctx.globalAlpha=sa;
        ctx.strokeStyle=`hsl(${38+i*10},100%,62%)`;ctx.lineWidth=3-i*.3;
        glow(ctx,`hsl(${38+i*10},100%,62%)`,22);
        ctx.beginPath();ctx.arc(cx,groundY,rp*W*0.78,PI,TAU);ctx.stroke();noGlow(ctx);
      }
      if(!s._finalDebris){
        s._finalDebris=Array.from({length:80},()=>{
          const a=rnd(-PI,0),sp=rnd(3,10);
          return{vx:Math.cos(a)*sp,vy:Math.sin(a)*sp,life:rnd(0.8,1.8),hue:rnd(30,60),sz:rnd(2,7)};
        });
      }
      s._finalDebris.forEach(pk=>{
        const a=Math.max(0,1-fAge/pk.life)*gA;if(a<=0.01) return;
        ctx.globalAlpha=a*a;
        glow(ctx,`hsl(${pk.hue},100%,60%)`,10);
        ctx.fillStyle=`hsl(${pk.hue+20},100%,78%)`;
        arc(ctx,cx+pk.vx*fAge*46,groundY+(pk.vy*fAge+0.12*fAge*fAge*46),pk.sz*a);
        ctx.fill();noGlow(ctx);
      });
    }
    ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';
  },null,castX,castY,bg);
};

/* ── SC-11 : 황천 폭풍검 (잔상 5연참 + 재귀 번개 + 흑백 섬광) ── */
scFns[11]=function(stage,castX,castY,bg){
  const TOTAL=3600;
  const slashDefs=[
    {t0:0.6,ang:-52,fy:0.36},{t0:0.76,ang:44,fy:0.56},{t0:0.92,ang:-20,fy:0.46},
    {t0:1.08,ang:12,fy:0.40},{t0:1.24,ang:-7,fy:0.50}
  ];

  return runCanvas(stage,TOTAL,(ctx,s,p)=>{
    const{W,H,cx,cy,t}=s;
    ctx.globalCompositeOperation='source-over';
    if(s.bg===false){ctx.globalCompositeOperation='destination-out';ctx.fillStyle='rgba(0,0,0,0.22)';ctx.fillRect(0,0,W,H);ctx.globalCompositeOperation='source-over';}else{ctx.fillStyle='rgba(2,0,6,0.22)';ctx.fillRect(0,0,W,H);}
    ctx.globalCompositeOperation='lighter';
    const phase1=clamp(t/0.6,0,1);  // charge
    const fadeOut=clamp((t-3.0)/0.6,0,1);
    const gA=1-fadeOut;

    // PHASE 1: Ominous static charge — plasma tendrils
    if(!s._static){
      s._static=Array.from({length:30},()=>({
        x:rnd(W*.1,W*.9),y:rnd(H*.2,H*.8),
        vx:rnd(-0.8,0.8),vy:rnd(-0.8,0.8),life:rnd(0.2,0.5),birth:rnd(0,0.5),hue:rnd(260,310)
      }));
    }
    s._static.forEach(pk=>{
      if(t<pk.birth) return;
      const age=t-pk.birth;const a=Math.max(0,1-age/pk.life)*phase1*(1-clamp((t-0.6)/.3,0,1))*gA;
      if(a<=0.02) return;
      ctx.globalAlpha=a;
      glow(ctx,`hsl(${pk.hue},100%,70%)`,10);
      ctx.strokeStyle=`hsl(${pk.hue+20},100%,88%)`;ctx.lineWidth=1.5;
      line(ctx,pk.x+pk.vx*age*30,pk.y+pk.vy*age*30,pk.x-pk.vx*age*15,pk.y-pk.vy*age*15);
      noGlow(ctx);
    });

    // Center charging orb
    if(phase1>0.1&&t<1.3){
      const cp=Math.sin(t*12)*.5+.5;
      const cr=4+phase1*12+cp*4;
      ctx.globalAlpha=phase1*(1-clamp((t-1.0)/.3,0,1))*gA;
      glow(ctx,'rgba(180,100,255,1)',20+cp*15);
      ctx.fillStyle='#fff';arc(ctx,cx,cy,cr);ctx.fill();noGlow(ctx);
    }

    // PHASE 2: 5-slash combo with afterimages
    slashDefs.forEach((sd,si)=>{
      const sp=clamp((t-sd.t0)/.18,0,1);if(sp<=0) return;
      const fy=H*sd.fy;
      const ex=1-Math.pow(1-sp,3);
      // ghost afterimages (3 layers fading)
      for(let gi=3;gi>=0;gi--){
        const ghostAge=(t-sd.t0)-(gi*0.06);
        if(ghostAge<0) continue;
        const ghostP=clamp(ghostAge/.18,0,1);
        const ghostFade=gi===0?1:Math.max(0,1-ghostAge/(.18+gi*0.12));
        if(ghostFade<=0.02) continue;
        const ghostEx=1-Math.pow(1-ghostP,3);
        const hue=si>=3?50:280;
        [20,8,2].forEach((blur,bi)=>{
          const baseA=gi===0?[0.8,0.95,0.95][bi]:[0.3,0.4,0.4][bi]*(1-gi*.2);
          ctx.globalAlpha=baseA*ghostFade*gA;
          glow(ctx,`hsl(${hue},100%,70%)`,blur);
          ctx.strokeStyle=bi===2?'rgba(255,255,255,0.95)':`hsl(${hue},100%,${70-bi*10}%)`;
          ctx.lineWidth=[4,2,0.9][bi];
          ctx.save();ctx.translate(cx,fy);ctx.rotate(sd.ang*PI/180);
          ctx.beginPath();ctx.moveTo(-W*.52*ghostEx,0);ctx.lineTo(W*.52*ghostEx,0);
          ctx.stroke();ctx.restore();noGlow(ctx);
        });
      }
      // impact sparks at slash endpoints
      if(!s[`ss${si}`]){
        s[`ss${si}`]=Array.from({length:30},()=>({
          ox:rnd(-W*.4,W*.4),vy:rnd(-3.5,-0.5),vx:rnd(-3,3),life:rnd(0.3,0.7),hue:rnd(260,320),sz:rnd(1,4)
        }));
      }
      const spAge=t-sd.t0;
      s[`ss${si}`].forEach(pk=>{
        const a=Math.max(0,1-spAge/pk.life)*gA;if(a<=0.02) return;
        ctx.globalAlpha=a;
        glow(ctx,`hsl(${pk.hue},100%,70%)`,8);
        ctx.fillStyle=`hsl(${pk.hue+20},100%,85%)`;
        arc(ctx,cx+pk.ox+pk.vx*spAge*40,fy+pk.vy*spAge*40,pk.sz*a);ctx.fill();noGlow(ctx);
      });
    });

    // PHASE 3: STORM FINALE — recursive lightning web
    if(t>1.4){
      const storAge=t-1.4;
      // B&W flash
      if(storAge<0.2){
        ctx.globalCompositeOperation='source-over';
        ctx.globalAlpha=(1-storAge/0.2)*.7*gA;
        ctx.fillStyle='rgba(255,255,255,1)';ctx.fillRect(0,0,W,H);
        ctx.globalCompositeOperation='lighter';
      }
      if(storAge<0.15){
        ctx.globalCompositeOperation='source-over';
        ctx.globalAlpha=(storAge/0.15)*.5*gA;
        ctx.fillStyle='rgba(100,30,200,1)';ctx.fillRect(0,0,W,H);
        ctx.globalCompositeOperation='lighter';
      }

      // Recursive lightning bolts (6 bolts, each re-seeds per frame for flicker)
      const numBolts=6;
      for(let b=0;b<numBolts;b++){
        const bAge=clamp(storAge-b*.08,0,999);if(bAge<=0) continue;
        const bA=Math.max(0,1-bAge/.5)*gA;if(bA<0.05) continue;
        // flicker
        if(Math.random()>.65) continue;
        const x0=cx+rnd(-W*.45,-W*.05),y0=cy+rnd(-H*.4,H*.4);
        const x1=cx+rnd(W*.05,W*.45),y1=cy+rnd(-H*.4,H*.4);
        ctx.globalAlpha=bA*.9;
        glow(ctx,'rgba(220,160,255,1)',22);
        ctx.strokeStyle='rgba(255,255,255,0.95)';ctx.lineWidth=2.2;
        drawBolt(ctx,x0,y0,x1,y1,3,'rgba(255,255,255,0.9)',bA*.9);
        ctx.strokeStyle='rgba(200,140,255,0.6)';ctx.lineWidth=6;
        glow(ctx,'rgba(180,100,255,1)',30);
        drawBolt(ctx,x0,y0,x1,y1,2,'rgba(200,140,255,0.5)',bA*.45);
        noGlow(ctx);
      }

      // Burst particles from center
      if(!s._burst){
        s._burst=Array.from({length:80},()=>{
          const a=Math.random()*TAU,sp=rnd(2.5,8);
          return{vx:Math.cos(a)*sp,vy:Math.sin(a)*sp,life:rnd(0.6,1.4),hue:rnd(260,315),sz:rnd(1,4)};
        });
      }
      s._burst.forEach(pk=>{
        const a=Math.max(0,1-storAge/pk.life)*gA;if(a<=0.01) return;
        ctx.globalAlpha=a;
        glow(ctx,`hsl(${pk.hue},100%,70%)`,9);
        ctx.fillStyle=`hsl(${pk.hue+20},100%,85%)`;
        arc(ctx,cx+pk.vx*storAge*55,cy+pk.vy*storAge*55,pk.sz*a);ctx.fill();noGlow(ctx);
      });

      // shockwave rings
      for(let i=0;i<4;i++){
        const rp=clamp((storAge-i*.06)/.65,0,1);if(rp<=0) continue;
        const sa=(1-rp)*0.6*gA;if(sa<.01) continue;
        ctx.globalAlpha=sa;
        ctx.strokeStyle=`hsl(${275+i*20},100%,65%)`;ctx.lineWidth=2.5;
        glow(ctx,`hsl(${275+i*20},100%,65%)`,22);
        arc(ctx,cx,cy,rp*W*0.75);ctx.stroke();noGlow(ctx);
      }
    }
    ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';
  },null,castX,castY,bg);
};

const DURATIONS={1:3800,2:4000,8:3600,10:4400,11:3800};

/* [FIX] 향후 기획 메모 → JS 소스에서 제거 (vfx-critique-report.md 참조) */

/* [FIX] SC showcase: 이전 RAF를 올바르게 취소하고 새 실행의 cancel 함수를 보관 */
const _scCancel={};
document.querySelectorAll('.sc-play').forEach(btn=>{
  btn.addEventListener('click',()=>{
    const id=parseInt(btn.dataset.sc);
    if(btn.disabled||!scFns[id])return;
    const stage=document.querySelector(`.sc-stage[data-sc="${id}"]`);
    if(!stage)return;
    // 이전 실행 중이면 RAF 취소 후 캔버스 정리
    if(_scCancel[id]){_scCancel[id]();_scCancel[id]=null;}
    stage.querySelectorAll('canvas.sc-cv').forEach(el=>el.remove());
    btn.disabled=true; btn.classList.add('playing');
    _scCancel[id]=scFns[id](stage)||null; // cancel fn 보관
    setTimeout(()=>{
      btn.disabled=false; btn.classList.remove('playing');
      _scCancel[id]=null;
    },DURATIONS[id]||3600);
  });
});



/* ── VFX GAME INTEGRATION: SC & alias registrations ─────── */
if (typeof window.VFX !== 'undefined') {
  // SC 계열 — one-shot stage-based: wrap to canvas-based (create canvas from stage)
  // SC 이펙트는 stage(div) 기반. wrapOneShot이 canvas 기반이므로 bridge 사용.
  const _scBridge = (scFn, scId) => (canvas, onDone, castX, castY, bg) => {
    const stageEl = document.querySelector(`.sc-stage[data-sc="${scId}"]`);
    if (!stageEl) { if (onDone) onDone(); return null; }
    const stopFn = scFn(stageEl, castX, castY, bg) || null;
    const dur = {1:3800,2:4000,8:3600,10:4400,11:3800}[scId] || 4000;
    const t = setTimeout(() => { if (onDone) onDone(); }, dur);
    return () => { clearTimeout(t); if (stopFn) stopFn(); };
  };
  if (typeof scFns !== 'undefined') {
    window.VFX._bulkOneShot({
      'SC-01': _scBridge(scFns[1], 1),
      'SC-02': _scBridge(scFns[2], 2),
      'SC-03': _scBridge(scFns[8], 8),
      'SC-04': _scBridge(scFns[10], 10),
      'SC-05': _scBridge(scFns[11], 11),
    });
  }
  console.log('[VFX] SC registered. Total:', window.VFX.list().length, 'effects');
}
/* ─────────────────────────────────────────────────────────── */
})(); // end showcase IIFE

  /* ═══════ VFX-V5 EXTENDED — standalone engine ═══════ */
  (function(){
    const rnd=(a,b)=>Math.random()*(b-a)+a, rni=(a,b)=>Math.floor(rnd(a,b+1));
    const PI=Math.PI, TAU=PI*2, clamp=(v,a,b)=>Math.max(a,Math.min(b,v)), lerp=(a,b,t)=>a+(b-a)*t;

    /* [FIX] 단일 공유 resize 핸들러 — 인스턴스별 window.addEventListener 누수 제거 */
    const _v5Entries=[];
    window.addEventListener('resize',()=>{
      for(let i=0;i<_v5Entries.length;i++){
        const e=_v5Entries[i];
        if(e.on){e.sync();if(e.eff.onResize)e.eff.onResize();}
      }
    },{passive:true});

    function v5mount(cid,oid,pid,maker){
      const cv=document.getElementById(cid);
      if(!cv)return;
      const ov=document.getElementById(oid), pu=document.getElementById(pid);
      const sync=()=>{const r=cv.parentElement.getBoundingClientRect();cv.width=r.width||400;cv.height=r.height||260;};
      sync();const eff=maker(cv);let rafId=null,lastTs=0,on=false;
      /* [FIX] 공유 배열에 등록 (resize 핸들러 참조용) */
      const _entry={on:false,sync,eff};
      _v5Entries.push(_entry);
      const start=()=>{if(on)return;sync();if(eff.onResize)eff.onResize();eff.init();on=true;_entry.on=true;if(ov)ov.classList.add('hidden');if(pu)pu.classList.add('visible');lastTs=performance.now();(function tick(ts){if(!on)return;const dt=Math.min((ts-lastTs)/16.667,3);lastTs=ts;eff.draw(dt,ts/1000);rafId=requestAnimationFrame(tick);})(lastTs);};
      const stop=()=>{if(!on)return;on=false;_entry.on=false;cancelAnimationFrame(rafId);if(eff.cleanup)eff.cleanup();if(ov)ov.classList.remove('hidden');if(pu)pu.classList.remove('visible');};
      if(ov)ov.addEventListener('click',start);
      if(pu)pu.addEventListener('click',stop);
      new IntersectionObserver(e=>{if(!e[0].isIntersecting&&on)stop();},{threshold:.05}).observe(cv.parentElement);
    }

  /* ===== VFX-V5 · v5-01 ===== */
  function v5_m1(cv){
  const ctx=cv.getContext('2d');let W,H;const sy=()=>{W=cv.width;H=cv.height;};
  const WDS=['IMPACT','FORCE','BREAK','SHATTER','VOID','FLUX','AXIS','STRIKE','BOLD','CRASH','SMASH','EDGE','MASS','BLAST','RAW'];
  let words=[],frags=[],st=0,shake=0,timeScale=1,timeWarpT=0;
  // shake state
  let shakeX=0,shakeY=0;

  class Word{
    constructor(){
      this.tx=WDS[rni(0,WDS.length-1)];this.sz=rnd(48,96);
      const s=rni(0,3);
      if(s===0){this.x=-220;this.y=rnd(H*.1,H*.9);this.vx=rnd(3,6);this.vy=rnd(-1.2,1.2);}
      else if(s===1){this.x=W+220;this.y=rnd(H*.1,H*.9);this.vx=-rnd(3,6);this.vy=rnd(-1.2,1.2);}
      else if(s===2){this.x=rnd(W*.1,W*.9);this.y=-80;this.vx=rnd(-1,1);this.vy=rnd(2.5,5);}
      else{this.x=rnd(W*.1,W*.9);this.y=H+80;this.vx=rnd(-1,1);this.vy=-rnd(2.5,5);}
      this.life=1;this.ttl=rnd(75,130);this.hot=Math.random()<.25;
      this.glitching=false;this.glitchT=0;
    }
    update(dt){
      const adt=dt*timeScale;
      this.x+=this.vx*adt;this.y+=this.vy*adt;this.ttl-=adt;
      // start glitch pre-explosion
      if(this.ttl<18&&!this.glitching){this.glitching=true;this.glitchT=0;}
      if(this.glitching)this.glitchT+=dt;
      if(this.ttl<=0){this.explode();this.life=0;}
    }
    explode(){
      // camera shake
      shake=14;timeScale=0.12;timeWarpT=0;
      const n=rni(14,24);
      for(let i=0;i<n;i++){
        const a=rnd(0,TAU),sp=rnd(2,10);
        frags.push({x:this.x,y:this.y,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp,s:this.sz*rnd(.07,.22),rot:rnd(0,TAU),vr:rnd(-0.18,0.18),life:1,decay:rnd(.006,.014),hot:this.hot});
      }
      if(frags.length>300)frags.splice(0,frags.length-300);
    }
    draw(){
      ctx.save();
      ctx.font=`900 ${this.sz}px 'Bebas Neue',sans-serif`;
      ctx.textAlign='center';ctx.textBaseline='middle';
      if(this.glitching){
        // RGB split
        const off=3+this.glitchT*6;
        ctx.globalAlpha=0.7;
        ctx.fillStyle='rgba(255,0,0,.8)';ctx.fillText(this.tx,this.x-off,this.y);
        ctx.fillStyle='rgba(0,255,255,.8)';ctx.fillText(this.tx,this.x+off,this.y+1);
        ctx.globalAlpha=1;
        // horizontal displacement strips
        const strips=3;
        for(let k=0;k<strips;k++){
          const sy2=this.y-this.sz*.5+k*(this.sz/strips);
          const dx=rnd(-8,8);
          ctx.save();ctx.beginPath();ctx.rect(this.x-200,sy2,400,this.sz/strips);ctx.clip();
          ctx.fillStyle=this.hot?'#ff4500':'#fff';ctx.shadowColor=this.hot?'#ff4500':'#fff';ctx.shadowBlur=6;
          ctx.fillText(this.tx,this.x+dx,this.y);ctx.restore();
        }
      }
      const col=this.hot?'#ff4500':'#ffffff';
      ctx.shadowColor=col;ctx.shadowBlur=this.hot?28:8;ctx.fillStyle=col;
      ctx.fillText(this.tx,this.x,this.y);ctx.restore();
    }
  }

  return{
    init(){sy();words=[];frags=[];st=0;shake=0;timeScale=1;timeWarpT=0;for(let i=0;i<4;i++)words.push(new Word());},
    onResize(){sy();},
    draw(dt,t){
      sy();
      // time warp recovery
      timeWarpT+=dt;
      if(timeScale<1){timeScale=Math.min(1,timeScale+dt*0.08);}
      // shake decay
      shake=Math.max(0,shake-dt*3.5);
      shakeX=shake>0.5?rnd(-shake,shake):0;
      shakeY=shake>0.5?rnd(-shake,shake):0;

      ctx.save();
      ctx.translate(shakeX,shakeY);

      ctx.fillStyle='#020202';ctx.fillRect(-shakeX-10,-shakeY-10,W+20,H+20);
      // grid
      ctx.strokeStyle='rgba(255,255,255,.025)';ctx.lineWidth=1;
      for(let x=0;x<W;x+=60){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,H);ctx.stroke();}
      for(let y=0;y<H;y+=60){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke();}

      st+=dt;if(st>48&&words.length<8){words.push(new Word());st=0;}
      words.forEach(w=>w.update(dt));
      /* [FIX] filter→인플레이스 역방향 splice */
      for(let _i=words.length-1;_i>=0;_i--){const w=words[_i];if(!(w.life>0&&w.x>-450&&w.x<W+450&&w.y>-200&&w.y<H+200))words.splice(_i,1);}

      frags.forEach(f=>{f.x+=f.vx*timeScale*dt;f.y+=f.vy*timeScale*dt;f.vy+=0.1*dt;f.rot+=f.vr*dt;f.life-=f.decay*dt;});
      /* [FIX] filter→인플레이스 역방향 splice */
      for(let _i=frags.length-1;_i>=0;_i--){if(frags[_i].life<=0.01)frags.splice(_i,1);}
      frags.forEach(f=>{
        if(f.life<=0)return;
        ctx.save();ctx.translate(f.x,f.y);ctx.rotate(f.rot);ctx.globalAlpha=f.life;
        const c=f.hot?'#ff4500':'#fff';ctx.fillStyle=c;ctx.shadowColor=c;ctx.shadowBlur=f.hot?14:3;
        ctx.beginPath();ctx.moveTo(0,-f.s);ctx.lineTo(f.s*.87,f.s*.5);ctx.lineTo(-f.s*.87,f.s*.5);ctx.closePath();ctx.fill();ctx.restore();
      });
      words.forEach(w=>w.draw());

      // scan line
      const sy2=((t*.28)%1)*H;
      const sg=ctx.createLinearGradient(0,sy2-5,0,sy2+5);
      sg.addColorStop(0,'transparent');sg.addColorStop(.5,'rgba(255,69,0,.14)');sg.addColorStop(1,'transparent');
      ctx.fillStyle=sg;ctx.fillRect(0,sy2-5,W,10);

      ctx.restore();// end shake transform
    },
    cleanup(){words=[];frags=[];}
  };
}

/* ============================================================
   02 · CELLULAR AUTOMATA — Heatmap + Mouse Draw
   ============================================================ */

  /* ===== VFX-V5 · v5-02 ===== */
  function v5_m2(cv){
  const ctx=cv.getContext('2d');let W,H;const sy=()=>{W=cv.width;H=cv.height;};
  const CS=8;let cols,rows,grid,next,trail,age,stepT=0;
  // mouse
  let mx=-1,my=-1,mdown=false;

  const mkG=()=>Array.from({length:rows},()=>new Uint8Array(cols));
  const mkT=()=>Array.from({length:rows},()=>new Float32Array(cols));
  const mkA=()=>Array.from({length:rows},()=>new Float32Array(cols));// age

  function stepLife(){
    for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){
      let n=0;
      for(let dr=-1;dr<=1;dr++)for(let dc=-1;dc<=1;dc++){
        if(dr===0&&dc===0)continue;
        n+=grid[(r+dr+rows)%rows][(c+dc+cols)%cols];
      }
      const alive=grid[r][c]?(n===2||n===3?1:0):(n===3?1:0);
      next[r][c]=alive;
      if(alive)age[r][c]=Math.min(age[r][c]+0.04,1);
      else age[r][c]=Math.max(age[r][c]-0.06,0);
    }
    [grid,next]=[next,grid];
  }

  function spawnAtMouse(){
    if(mx<0||my<0)return;
    const mc=Math.floor(mx/CS),mr=Math.floor(my/CS);
    for(let dr=-2;dr<=2;dr++)for(let dc=-2;dc<=2;dc++){
      const nr=mr+dr,nc=mc+dc;
      if(nr>=0&&nr<rows&&nc>=0&&nc<cols)grid[nr][nc]=1;
    }
  }

  function setupMouse(){
    const rect=()=>cv.getBoundingClientRect();
    const px=(e)=>{const r=rect();return(e.clientX-r.left)*(W/r.width);};
    const py=(e)=>{const r=rect();return(e.clientY-r.top)*(H/r.height);};
    cv.addEventListener('mousedown',e=>{mdown=true;mx=px(e);my=py(e);spawnAtMouse();});
    cv.addEventListener('mousemove',e=>{mx=px(e);my=py(e);if(mdown)spawnAtMouse();});
    cv.addEventListener('mouseup',()=>mdown=false);
    cv.addEventListener('mouseleave',()=>{mdown=false;mx=-1;my=-1;});
    cv.addEventListener('touchstart',e=>{e.preventDefault();mdown=true;const t2=e.touches[0],r=rect();mx=(t2.clientX-r.left)*(W/r.width);my=(t2.clientY-r.top)*(H/r.height);spawnAtMouse();},{passive:false});
    cv.addEventListener('touchmove',e=>{e.preventDefault();const t2=e.touches[0],r=rect();mx=(t2.clientX-r.left)*(W/r.width);my=(t2.clientY-r.top)*(H/r.height);spawnAtMouse();},{passive:false});
    cv.addEventListener('touchend',()=>mdown=false);
  }

  const ri=()=>{sy();cols=Math.floor(W/CS);rows=Math.floor(H/CS);grid=mkG();next=mkG();trail=mkT();age=mkA();stepT=0;for(let r=0;r<rows;r++)for(let c=0;c<cols;c++)grid[r][c]=Math.random()<0.3?1:0;};

  return{
    init(){ri();setupMouse();},
    onResize(){ri();},
    draw(dt){
      sy();ctx.fillStyle='#000811';ctx.fillRect(0,0,W,H);
      const dc=Math.pow(0.92,dt);
      for(let r=0;r<rows;r++)for(let c=0;c<cols;c++)trail[r][c]=clamp(trail[r][c]*dc+(grid[r][c]?1:0)*(1-dc),0,1);
      stepT+=dt;if(stepT>7.5){stepT=0;stepLife();}
      let alive=0;for(let r=0;r<rows;r++)for(let c=0;c<cols;c++)alive+=grid[r][c];
      if(alive<cols*rows*0.02)for(let r=0;r<rows;r++)for(let c=0;c<cols;c++)grid[r][c]=Math.random()<0.3?1:0;

      for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){
        const tr=trail[r][c];if(tr<0.015)continue;
        ctx.fillStyle=`rgba(140,0,255,${(tr*0.65).toFixed(3)})`;ctx.fillRect(c*CS,r*CS,CS-1,CS-1);
      }
      for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){
        if(!grid[r][c])continue;
        const a=age[r][c];
        // heatmap: young=green, mid=yellow, old=red
        let cr,cg,cb;
        if(a<0.4){const f=a/0.4;cr=Math.floor(f*200);cg=220;cb=Math.floor((1-f)*100);}
        else if(a<0.75){const f=(a-0.4)/0.35;cr=200+Math.floor(f*55);cg=Math.floor(220*(1-f*0.6));cb=0;}
        else{cr=255;cg=Math.floor(60*(1-(a-0.75)/0.25));cb=0;}
        ctx.fillStyle=`rgba(${cr},${cg},${cb},0.9)`;
        ctx.shadowColor=`rgb(${cr},${cg},${cb})`;ctx.shadowBlur=8;
        ctx.fillRect(c*CS,r*CS,CS-1,CS-1);ctx.shadowBlur=0;
      }
      // mouse glow trail
      if(mx>=0&&my>=0){
        const g=ctx.createRadialGradient(mx,my,0,mx,my,CS*3);
        g.addColorStop(0,'rgba(0,255,140,.35)');g.addColorStop(1,'transparent');
        ctx.fillStyle=g;ctx.fillRect(mx-CS*3,my-CS*3,CS*6,CS*6);
      }
      ctx.fillStyle='rgba(0,0,0,.17)';for(let y=0;y<H;y+=2)ctx.fillRect(0,y,W,1);
      const vg=ctx.createRadialGradient(W/2,H/2,H*0.2,W/2,H/2,H*0.78);
      vg.addColorStop(0,'transparent');vg.addColorStop(1,'rgba(0,0,0,.72)');
      ctx.fillStyle=vg;ctx.fillRect(0,0,W,H);
    },
    cleanup(){grid=null;next=null;trail=null;age=null;}
  };
}


/* ============================================================
   04 · BIO-PUNK SHOCKWAVE — Metaball + Heartbeat Vignette
   ============================================================ */

  /* ===== VFX-V5 · v5-03 ===== */
  function v5_m4(cv){
  const ctx=cv.getContext('2d');let W,H;const sy=()=>{W=cv.width;H=cv.height;};
  let cells=[],waves=[],sT=0,hue=0;const MC=280;

  class Wave{
    constructor(cx,cy){this.cx=cx;this.cy=cy;this.r=0;this.mR=Math.max(W,H)*0.78;this.sp=rnd(1.6,3.2);this.life=1;this.hue=hue;this.noise=Array.from({length:120},()=>rnd(-11,11));}
    update(dt){this.r+=this.sp*dt;this.life=clamp(1-this.r/this.mR,0,1);}
    draw(){
      if(this.life<=0)return;
      const n=this.noise.length;ctx.save();
      ctx.strokeStyle=`hsla(${this.hue},88%,64%,${(this.life*0.85).toFixed(3)})`;
      ctx.lineWidth=1.8+this.life*2.5;ctx.shadowColor=`hsla(${this.hue},100%,68%,1)`;ctx.shadowBlur=14;
      ctx.beginPath();
      for(let i=0;i<n;i++){const a=TAU/n*i,nr=this.r+this.noise[i];i===0?ctx.moveTo(this.cx+Math.cos(a)*nr,this.cy+Math.sin(a)*nr):ctx.lineTo(this.cx+Math.cos(a)*nr,this.cy+Math.sin(a)*nr);}
      ctx.closePath();ctx.stroke();ctx.restore();
    }
  }

  class Cell{
    constructor(x,y,r,h){
      this.x=x;this.y=y;this.r=r;this.hue=h;this.vx=rnd(-1.2,1.2);this.vy=rnd(-1.2,1.2);
      this.life=1;this.dec=rnd(.004,.013);this.pts=Array.from({length:11},()=>rnd(.68,1.32));
      this.rot=rnd(0,TAU);this.vr=rnd(-0.025,0.025);this.dT=rnd(55,110);this.divided=false;
      this.divStretch=0;// metaball stretch
    }
    update(dt){
      this.x+=this.vx*dt;this.y+=this.vy*dt;this.vx*=0.99;this.vy*=0.99;
      this.rot+=this.vr*dt;this.life-=this.dec*dt;this.dT-=dt;
      if(this.dT<15&&this.dT>0)this.divStretch=Math.sin((15-this.dT)/15*PI)*0.6;
      else this.divStretch*=0.88;
    }
    divide(){
      if(this.divided||this.r<6)return null;this.divided=true;const r2=this.r*0.58;
      return[new Cell(this.x+rnd(-8,8),this.y+rnd(-8,8),r2,(this.hue+rnd(-25,25)+360)%360),
             new Cell(this.x+rnd(-8,8),this.y+rnd(-8,8),r2,(this.hue+rnd(-25,25)+360)%360)];
    }
    draw(){
      ctx.save();ctx.translate(this.x,this.y);ctx.rotate(this.rot);ctx.globalAlpha=this.life;
      const n=this.pts.length;
      // metaball stretch: scale x slightly on divide
      const sx=1+this.divStretch*0.5,sy2=1-this.divStretch*0.3;
      ctx.scale(sx,sy2);
      ctx.beginPath();
      for(let i=0;i<n;i++){const a=TAU/n*i,r=this.r*this.pts[i];i===0?ctx.moveTo(Math.cos(a)*r,Math.sin(a)*r):ctx.lineTo(Math.cos(a)*r,Math.sin(a)*r);}
      ctx.closePath();
      const grd=ctx.createRadialGradient(0,0,0,0,0,this.r);
      grd.addColorStop(0,`hsla(${this.hue+40},80%,72%,.22)`);grd.addColorStop(1,`hsla(${this.hue},90%,55%,.04)`);
      ctx.fillStyle=grd;ctx.fill();
      ctx.strokeStyle=`hsla(${this.hue},88%,64%,${(this.life*0.9).toFixed(3)})`;ctx.lineWidth=1;
      ctx.shadowColor=`hsla(${this.hue},100%,68%,1)`;ctx.shadowBlur=7;ctx.stroke();ctx.restore();
    }
  }

  return{
    init(){sy();cells=[];waves=[];sT=0;hue=0;waves.push(new Wave(W/2,H/2));},
    onResize(){sy();},
    draw(dt,t){
      sy();ctx.fillStyle='rgba(2,0,5,.14)';ctx.fillRect(0,0,W,H);
      hue=(hue+0.3*dt)%360;
      sT+=dt;if(sT>175&&waves.length<3){sT=0;waves.push(new Wave(rnd(W*0.2,W*0.8),rnd(H*0.2,H*0.8)));}
      waves.forEach(w=>w.update(dt));
      /* [FIX] filter→인플레이스 역방향 splice */
      for(let _i=waves.length-1;_i>=0;_i--){if(!(waves[_i].life>0))waves.splice(_i,1);}
      waves.forEach(w=>w.draw());
      waves.forEach(w=>{if(Math.random()<0.07*dt&&cells.length<MC){const a=rnd(0,TAU);cells.push(new Cell(w.cx+Math.cos(a)*w.r,w.cy+Math.sin(a)*w.r,rnd(4,16),(w.hue+rnd(-35,35)+360)%360));}});
      const nC=[];
      cells.forEach(c=>{c.update(dt);if(c.dT<=0&&!c.divided&&cells.length+nC.length<MC){const d=c.divide();if(d)nC.push(...d);}c.draw();});
      /* [FIX] filter+spread→인플레이스: 만료 항목 제거 후 nC 병합 */
      for(let _i=cells.length-1;_i>=0;_i--){if(!(cells[_i].life>0.01))cells.splice(_i,1);}
      if(nC.length)cells.push(...nC);
      if(waves.length===0&&cells.length<10)waves.push(new Wave(rnd(W*0.2,W*0.8),rnd(H*0.2,H*0.8)));

      // subtle dark vignette only
      const vgR=ctx.createRadialGradient(W/2,H/2,H*0.08,W/2,H/2,H*0.72);
      vgR.addColorStop(0,'transparent');vgR.addColorStop(1,'rgba(0,0,0,.68)');
      ctx.fillStyle=vgR;ctx.fillRect(0,0,W,H);
    },
    cleanup(){cells=[];waves=[];}
  };
}

/* ============================================================
   05 · MAXIMALIST VOID — Subliminal Flash + Color Invert
   ============================================================ */

  /* ===== VFX-V5 · v5-04 ===== */
  function v5_m5(cv){
  const ctx=cv.getContext('2d');let W,H;const sy=()=>{W=cv.width;H=cv.height;};
  const PR=['#FF1A1A','#0025FF','#FFE300','#000000','#FF6B00','#FFFFFF','#00CC44'];
  const GLITCH_WORDS=['ERROR','VOID','NULL','0xFF','DEAD','FAULT','ABORT','SYS_FAIL'];
  let elems=[],frags=[],bars=[],rT=0,bT=0;
  let subFlash=0,subWord='',invertFlash=0,invertNext=220;

  class Geo{
    constructor(){this.type=rni(0,3);this.x=rnd(W*0.04,W*0.96);this.y=rnd(H*0.04,H*0.96);this.s=rnd(18,85);this.col=PR[rni(0,PR.length-1)];this.rot=rnd(0,TAU);this.vr=rnd(-0.04,0.04);this.vx=rnd(-0.4,0.4);this.vy=rnd(-0.4,0.4);}
    update(dt){this.rot+=this.vr*dt;this.x+=this.vx*dt;this.y+=this.vy*dt;}
    boom(){
      const n=rni(7,14);
      for(let i=0;i<n;i++){const a=rnd(0,TAU),sp=rnd(2.5,9);frags.push({x:this.x,y:this.y,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp,s:this.s*rnd(0.08,0.28),rot:rnd(0,TAU),vr:rnd(-0.22,0.22),life:1,dec:rnd(.005,.013),col:this.col,tp:rni(0,1)});}
      if(frags.length>280)frags.splice(0,frags.length-280);
      // subliminal flash
      subFlash=2.2;subWord=GLITCH_WORDS[rni(0,GLITCH_WORDS.length-1)];
    }
    draw(){ctx.save();ctx.translate(this.x,this.y);ctx.rotate(this.rot);const ec=this.col==='#FF1A1A'?'rgba(0,100,255,.28)':'rgba(255,0,60,.28)';ctx.strokeStyle='#000';ctx.lineWidth=2;this._s(ctx,this.s,ec,3,3);this._s(ctx,this.s,this.col,0,0);ctx.restore();}
    _s(c,s,fc,ox,oy){c.fillStyle=fc;c.beginPath();if(this.type===0)c.rect(ox-s/2,oy-s/2,s,s);else if(this.type===1)c.arc(ox,oy,s/2,0,TAU);else if(this.type===2){c.moveTo(ox,oy-s/2);c.lineTo(ox+s/2,oy+s/2);c.lineTo(ox-s/2,oy+s/2);c.closePath();}else{c.rect(ox-s/2,oy-s*0.14,s,s*0.28);c.rect(ox-s*0.14,oy-s/2,s*0.28,s);}c.fill();c.stroke();}
  }
  class Bar{
    constructor(){this.x=rnd(0,W*0.85);this.y=rnd(0,H);this.w=rnd(38,110);this.h=rnd(45,95);this.col=PR[rni(0,PR.length-1)];this.life=rnd(.45,.9);let bx=0;this.bars=[];const nb=rni(12,26);for(let i=0;i<nb;i++){const bw=rnd(1,3.5);this.bars.push({x:bx,w:bw});bx+=bw+rnd(.4,2);}this.totalSpan=bx||1;}
    draw(){ctx.save();ctx.globalAlpha=this.life*0.65;const sx=this.w/this.totalSpan;this.bars.forEach(b=>{ctx.fillStyle=this.col;ctx.fillRect(this.x+b.x*sx,this.y,b.w*sx,this.h);});ctx.restore();}
  }

  return{
    init(){sy();elems=[];frags=[];bars=[];rT=0;bT=0;subFlash=0;invertFlash=0;invertNext=rnd(180,300);for(let i=0;i<13;i++)elems.push(new Geo());for(let i=0;i<9;i++)bars.push(new Bar());},
    onResize(){sy();},
    draw(dt,t){
      sy();
      ctx.fillStyle='#ede8d8';ctx.fillRect(0,0,W,H);
      ctx.fillStyle='rgba(0,0,0,.04)';const gs=22;
      for(let y=gs/2;y<H;y+=gs)for(let x=gs/2;x<W;x+=gs){ctx.beginPath();ctx.arc(x,y,1.8,0,TAU);ctx.fill();}
      bars.forEach(b=>b.draw());
      bT+=dt;if(bT>65){bT=0;if(elems.length)elems[rni(0,elems.length-1)].boom();}
      rT+=dt;if(rT>380){rT=0;frags=[];elems=[];bars=[];for(let i=0;i<13;i++)elems.push(new Geo());for(let i=0;i<9;i++)bars.push(new Bar());}
      elems.forEach(e=>e.update(dt));elems.forEach(e=>e.draw());
      frags.forEach(f=>{f.x+=f.vx*dt;f.y+=f.vy*dt;f.vy+=0.11*dt;f.vx*=0.985;f.rot+=f.vr*dt;f.life-=f.dec*dt;
        if(f.life<=0)return;ctx.save();ctx.translate(f.x,f.y);ctx.rotate(f.rot);ctx.globalAlpha=f.life;ctx.fillStyle=f.col;ctx.strokeStyle='#000';ctx.lineWidth=1;ctx.beginPath();if(f.tp===0)ctx.rect(-f.s/2,-f.s/2,f.s,f.s);else{ctx.moveTo(0,-f.s/2);ctx.lineTo(f.s/2,f.s/2);ctx.lineTo(-f.s/2,f.s/2);ctx.closePath();}ctx.fill();ctx.stroke();ctx.restore();
      });
      /* [FIX] filter→인플레이스 역방향 splice */
      for(let _i=frags.length-1;_i>=0;_i--){if(frags[_i].life<=0.01)frags.splice(_i,1);}

      // subliminal flash (1-2 frame glitch text)
      subFlash=Math.max(0,subFlash-dt*3.5);
      if(subFlash>0.5){
        const sf=subFlash/2.2;
        ctx.save();ctx.globalAlpha=sf;
        ctx.font=`900 ${Math.floor(H*0.25)}px 'Bebas Neue',sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';
        ctx.fillStyle=`rgba(255,0,0,${sf})`;ctx.fillText(subWord,W*0.5+rnd(-8,8),H*0.5+rnd(-8,8));
        ctx.fillStyle=`rgba(0,255,255,${sf*0.5})`;ctx.fillText(subWord,W*0.5+4,H*0.5+2);
        // random barcode strips
        for(let i=0;i<6;i++){ctx.fillStyle=`rgba(0,0,0,${sf*0.8})`;ctx.fillRect(rnd(0,W*0.8),rnd(0,H*0.8),rnd(20,120),rnd(3,12));}
        ctx.restore();
      }

      // color invert flash
      invertFlash=Math.max(0,invertFlash-dt*4);
      invertNext-=dt;
      if(invertNext<=0){invertFlash=1.8;invertNext=rnd(160,340);}
      if(invertFlash>0.2){
        ctx.save();ctx.globalCompositeOperation='difference';ctx.globalAlpha=clamp(invertFlash/1.8,0,1)*0.92;
        ctx.fillStyle='#ffffff';ctx.fillRect(0,0,W,H);ctx.restore();
      }
    },
    cleanup(){elems=[];frags=[];bars=[];}
  };
}

/* ============================================================
   06 · DNA DOUBLE HELIX — Textbook Model
   B-DNA: sugar-phosphate backbones, colour-coded base pairs,
   H-bond dashes (2 for A-T, 3 for G-C), streaming particles
   ============================================================ */

  /* ===== VFX-V5 · v5-05 ===== */
  function v5_m7(cv){
  const ctx=cv.getContext('2d');let W,H;const sy=()=>{W=cv.width;H=cv.height;};
  const GW=200,GH=150,N=20,K=6;
  let grid,next,offCv,octx,imgData,sA=0;
  let blobs=[];const NBLOB=7;
  const mkG=()=>new Uint8Array(GW*GH);

  function step(){
    for(let r=0;r<GH;r++)for(let c=0;c<GW;c++){
      const s=grid[r*GW+c];
      if(s===0){let ex=0;for(let dr=-1;dr<=1;dr++)for(let dc=-1;dc<=1;dc++){if(dr===0&&dc===0)continue;let nr=r+dr;if(nr<0)nr+=GH;else if(nr>=GH)nr-=GH;let nc=c+dc;if(nc<0)nc+=GW;else if(nc>=GW)nc-=GW;const ns=grid[nr*GW+nc];if(ns>=1&&ns<K)ex++;}next[r*GW+c]=ex>=1?1:0;}
      else next[r*GW+c]=(s+1)%N;
    }
    const tmp=grid;grid=next;next=tmp;
  }
  function seed(){const fill=Math.random()<0.5?0.18:0.22;for(let i=0;i<GW*GH;i++)grid[i]=Math.random()<fill?Math.floor(Math.random()*N):0;}

  // Large slow glowing blob orbs — few massive, not many tiny
  class BlobOrb{
    constructor(){this.reset(true);}
    reset(init){
      this.x=rnd(W*0.1,W*0.9);this.y=rnd(H*0.1,H*0.9);
      this.vx=rnd(-0.35,0.35);this.vy=rnd(-0.25,0.25);
      this.hue=rnd(200,330);this.r=rnd(38,75);// large blobs
      this.phase=rnd(0,TAU);this.life=init?rnd(0.4,1):1;
      this.decay=rnd(0.0008,0.0018);// very slow decay
    }
    update(dt,t){
      this.x+=this.vx*dt;this.y+=this.vy*dt;
      this.vx+=Math.sin(t*1.1+this.phase)*0.04;this.vy+=Math.cos(t*0.9+this.phase)*0.04;
      this.vx*=0.97;this.vy*=0.97;
      this.life-=this.decay*dt;
      if(this.x<-80||this.x>W+80||this.y<-80||this.y>H+80||this.life<=0)this.reset(false);
    }
    draw(t){
      const pulse=0.7+0.3*Math.sin(t*1.8+this.phase);
      const a=this.life*pulse;
      const gr=ctx.createRadialGradient(this.x,this.y,0,this.x,this.y,this.r*pulse);
      gr.addColorStop(0,`hsla(${this.hue},100%,82%,${(a*0.55).toFixed(3)})`);
      gr.addColorStop(0.4,`hsla(${this.hue},100%,60%,${(a*0.28).toFixed(3)})`);
      gr.addColorStop(1,'transparent');
      ctx.fillStyle=gr;ctx.fillRect(this.x-this.r*pulse,this.y-this.r*pulse,this.r*pulse*2,this.r*pulse*2);
      // bright core
      ctx.beginPath();ctx.arc(this.x,this.y,6+4*pulse,0,TAU);
      ctx.fillStyle=`hsla(${this.hue},100%,92%,${(a*0.8).toFixed(3)})`;
      ctx.shadowColor=`hsl(${this.hue},100%,75%)`;ctx.shadowBlur=28;ctx.fill();ctx.shadowBlur=0;
    }
  }

  return{
    init(){sy();grid=mkG();next=mkG();sA=0;seed();for(let i=0;i<90;i++)step();offCv=document.createElement('canvas');offCv.width=GW;offCv.height=GH;octx=offCv.getContext('2d');imgData=octx.createImageData(GW,GH);blobs=[];for(let i=0;i<NBLOB;i++)blobs.push(new BlobOrb());},
    onResize(){sy();},
    draw(dt,t){
      sy();ctx.fillStyle='#060012';ctx.fillRect(0,0,W,H);
      sA+=dt;let it=0;while(sA>=1&&it<3){step();sA-=1;it++;}
      let al=0;for(let i=0;i<GW*GH;i++)if(grid[i]>0)al++;
      if(al<GW*GH*0.015){seed();for(let i=0;i<60;i++)step();}

      const d=imgData.data;
      for(let i=0;i<GW*GH;i++){
        const s=grid[i];let r,g,b;
        if(s===0){r=6;g=1;b=24;}
        else if(s<K){const f=s/(K-1);r=Math.floor(f*150);g=Math.floor(f*4);b=Math.floor(f*130);}
        else{const f=clamp(1-(s-K)/(N-K-1),0,1);r=Math.floor(f*7);g=Math.floor(f*148);b=Math.floor(f*138);}
        const idx=i*4;d[idx]=r;d[idx+1]=g;d[idx+2]=b;d[idx+3]=255;
      }
      octx.putImageData(imgData,0,0);
      ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
      ctx.drawImage(offCv,0,0,W,H);
      ctx.globalCompositeOperation='screen';ctx.globalAlpha=0.10;ctx.drawImage(offCv,-W*0.012,-H*0.012,W*1.024,H*1.024);ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';

      // neon contour blobs rendered below

      // large luminous orbs drift across wave field
      blobs.forEach(b=>{b.update(dt,t);b.draw(t);});

      const vg=ctx.createRadialGradient(W/2,H/2,H*0.08,W/2,H/2,H*0.72);
      vg.addColorStop(0,'transparent');vg.addColorStop(1,'rgba(0,0,0,.65)');ctx.fillStyle=vg;ctx.fillRect(0,0,W,H);
      ctx.font='400 8px "Space Mono",monospace';ctx.fillStyle='rgba(180,140,220,.22)';ctx.textAlign='right';ctx.fillText('BZ · EXCITABLE MEDIA',W-16,H-14);ctx.textAlign='left';
    },
    cleanup(){grid=null;next=null;offCv=null;imgData=null;blobs=[];}
  };
}

/* ============================================================
   08 · CYMATICS — Constellation Web + Ripple Distortion
   ============================================================ */

  /* ===== VFX-V5 · v5-06 ===== */
  function v5_m8(cv){
  const ctx=cv.getContext('2d');let W,H;const sy=()=>{W=cv.width;H=cv.height;};
  const NP=780;let particles=[],mT=0,mI=0,trT=0,transitioning=false;
  const MODES=[[2,1],[2,2],[3,1],[3,2],[3,3],[4,1],[4,2],[4,3],[5,2],[5,3]];
  const MNAMES=['(2,1)','(2,2)','(3,1)','(3,2)','(3,3)','(4,1)','(4,2)','(4,3)','(5,2)','(5,3)'];
  const MD=500,TD=100;const MHUE=[48,46,44,50,42,52,40,54,38,56];let flashB=0;
  let ripples=[];// {t,maxR}

  function chladni(x,y,m,n){const nx=x/W,ny=y/H;return Math.cos(m*PI*nx)*Math.cos(n*PI*ny)-Math.cos(n*PI*nx)*Math.cos(m*PI*ny);}
  function cGrad(x,y,m,n){const nx=x/W,ny=y/H,mw=m*PI/W,nw=n*PI/W,mh=m*PI/H,nh=n*PI/H;const f=-mw*Math.sin(m*PI*nx)*Math.cos(n*PI*ny)+nw*Math.sin(n*PI*nx)*Math.cos(m*PI*ny);const g=-nh*Math.cos(m*PI*nx)*Math.sin(n*PI*ny)+mh*Math.cos(n*PI*nx)*Math.sin(m*PI*ny);return{f:chladni(x,y,m,n),gx:f,gy:g};}
  function drawField(m,n,alpha){const step=14;for(let x=0;x<W;x+=step)for(let y=0;y<H;y+=step){const f=chladni(x+step/2,y+step/2,m,n),af=Math.abs(f);if(af<0.07){const a=alpha*(1-af/0.07)*0.35;ctx.fillStyle=`rgba(255,215,60,${a.toFixed(3)})`;ctx.fillRect(x,y,step,step);}}}

  return{
    init(){sy();particles=[];mT=0;mI=0;trT=0;transitioning=false;ripples=[];for(let i=0;i<NP;i++)particles.push({x:rnd(W*0.04,W*0.96),y:rnd(H*0.04,H*0.96),vx:0,vy:0,bright:0});},
    onResize(){sy();particles.forEach(p=>{p.x=rnd(W*0.04,W*0.96);p.y=rnd(H*0.04,H*0.96);p.vx=0;p.vy=0;});},
    draw(dt,t){
      sy();ctx.fillStyle='rgba(2,3,14,.19)';ctx.fillRect(0,0,W,H);
      mT+=dt;flashB*=Math.pow(0.9,dt);
      if(!transitioning&&mT>MD){transitioning=true;trT=0;mT=0;// spawn ripple
      ripples.push({r:0,maxR:Math.max(W,H)*0.8,life:1});flashB=1;}
      if(transitioning){trT+=dt;if(trT>TD){transitioning=false;mI=(mI+1)%MODES.length;}}
      const[m0,n0]=MODES[mI],[m1,n1]=MODES[(mI+1)%MODES.length];
      const blend=transitioning?clamp(trT/TD,0,1):0,turb=transitioning?2.8:0.55;const fA=transitioning?lerp(0.28,0,blend):0.28;
      drawField(m0,n0,fA*(1-blend));if(transitioning&&blend>0.2)drawField(m1,n1,fA*blend);
      ctx.shadowBlur=0;

      particles.forEach(p=>{
        const g0=cGrad(p.x,p.y,m0,n0),g1=cGrad(p.x,p.y,m1,n1);
        const f=lerp(g0.f,g1.f,blend),gx=lerp(g0.gx,g1.gx,blend),gy=lerp(g0.gy,g1.gy,blend);
        const sign=f>0?1:-1,mag=Math.sqrt(gx*gx+gy*gy)+1e-6;
        p.vx+=(-sign*gx/mag*3.8+(Math.random()-0.5)*turb)*dt;p.vy+=(-sign*gy/mag*3.8+(Math.random()-0.5)*turb)*dt;
        p.vx*=0.91;p.vy*=0.91;p.x+=p.vx*dt;p.y+=p.vy*dt;
        if(p.x<4){p.x=4;p.vx*=-0.5;}if(p.x>W-4){p.x=W-4;p.vx*=-0.5;}if(p.y<4){p.y=4;p.vy*=-0.5;}if(p.y>H-4){p.y=H-4;p.vy*=-0.5;}
        const af=Math.abs(f);p.bright=Math.max(0,1-af*4.2);
        const alpha=(0.16+p.bright*0.84).toFixed(3),sz=0.6+p.bright*2.8;
        const hue=MHUE[mI];
        if(p.bright>0.5){ctx.globalCompositeOperation='lighter';
          ctx.fillStyle=`hsla(${hue-14},100%,60%,${(p.bright*0.4).toFixed(3)})`;ctx.beginPath();ctx.arc(p.x-1.1,p.y,sz,0,TAU);ctx.fill();
          ctx.fillStyle=`hsla(${hue+18},100%,60%,${(p.bright*0.4).toFixed(3)})`;ctx.beginPath();ctx.arc(p.x+1.1,p.y,sz,0,TAU);ctx.fill();}
        const cr=Math.floor(p.bright*255+40),cg=Math.floor(p.bright*195),cb=Math.floor(p.bright*28);
        ctx.fillStyle=`rgba(${cr},${cg},${cb},${alpha})`;
        if(p.bright>0.65){ctx.shadowColor='rgba(255,205,50,.7)';ctx.shadowBlur=9;}
        ctx.beginPath();ctx.arc(p.x,p.y,sz,0,TAU);ctx.fill();if(p.bright>0.65)ctx.shadowBlur=0;ctx.globalCompositeOperation='source-over';
      });ctx.shadowBlur=0;

      // constellation: connect nearby bright particles
      // bright는 읽기 전용 임시 배열이므로 filter 유지 (원본 particles 불변)
      const bright=particles.filter(p=>p.bright>0.6);
      const CDIST=W*0.06;
      ctx.strokeStyle='rgba(255,210,60,.18)';ctx.lineWidth=0.6;
      for(let i=0;i<bright.length;i+=3){
        for(let j=i+1;j<bright.length&&j<i+12;j+=2){
          const dx=bright[i].x-bright[j].x,dy=bright[i].y-bright[j].y;
          const d=Math.sqrt(dx*dx+dy*dy);
          if(d<CDIST){
            const a=(1-d/CDIST)*0.35*(bright[i].bright+bright[j].bright)*0.5;
            ctx.strokeStyle=`rgba(255,210,60,${a.toFixed(3)})`;
            ctx.shadowColor='rgba(255,210,60,.4)';ctx.shadowBlur=4;
            ctx.beginPath();ctx.moveTo(bright[i].x,bright[i].y);ctx.lineTo(bright[j].x,bright[j].y);ctx.stroke();ctx.shadowBlur=0;
          }
        }
      }

      // ripple distortion
      ripples.forEach(rp=>{rp.r+=dt*(Math.max(W,H)*0.012);rp.life=clamp(1-rp.r/rp.maxR,0,1);});
      /* [FIX] filter→인플레이스 역방향 splice */
      for(let _i=ripples.length-1;_i>=0;_i--){if(ripples[_i].life<=0.01)ripples.splice(_i,1);}
      ripples.forEach(rp=>{
        const a=rp.life*0.7;
        ctx.beginPath();ctx.arc(W/2,H/2,rp.r,0,TAU);ctx.strokeStyle=`rgba(255,215,60,${a.toFixed(3)})`;ctx.lineWidth=2+rp.life*4;ctx.shadowColor='rgba(255,215,60,.8)';ctx.shadowBlur=20*rp.life;ctx.stroke();ctx.shadowBlur=0;
        // inner ring
        if(rp.r>20){ctx.beginPath();ctx.arc(W/2,H/2,rp.r*0.92,0,TAU);ctx.strokeStyle=`rgba(255,180,40,${(a*0.4).toFixed(3)})`;ctx.lineWidth=0.8;ctx.stroke();}
      });

      if(flashB>0.02){ctx.save();ctx.globalCompositeOperation='lighter';const fb=ctx.createRadialGradient(W/2,H/2,0,W/2,H/2,Math.min(W,H)*0.5*flashB);fb.addColorStop(0,`rgba(255,238,170,${(flashB*0.4).toFixed(3)})`);fb.addColorStop(1,'rgba(255,210,90,0)');ctx.fillStyle=fb;ctx.beginPath();ctx.arc(W/2,H/2,Math.min(W,H)*0.5*flashB,0,TAU);ctx.fill();ctx.restore();}
      ctx.font='600 11px "Space Mono",monospace';ctx.textAlign='left';ctx.fillStyle='rgba(255,200,55,.6)';ctx.fillText('CHLADNI RESONANCE',14,22);
      ctx.font='400 9px "Space Mono",monospace';ctx.fillStyle='rgba(255,200,55,.32)';ctx.fillText(`Mode ${MNAMES[mI]}`,14,36);ctx.textAlign='left';
      const vg=ctx.createRadialGradient(W/2,H/2,H*0.12,W/2,H/2,H*0.74);vg.addColorStop(0,'transparent');vg.addColorStop(1,'rgba(0,0,0,.68)');ctx.fillStyle=vg;ctx.fillRect(0,0,W,H);
    },
    cleanup(){particles=[];ripples=[];}
  };
}

/* ============================================================
   09 · CHERENKOV RADIATION — Starfield + Chromatic Aberration
   ============================================================ */

  /* ===== VFX-V5 · v5-07 ===== */
  function v5_m9(cv){
  const ctx=cv.getContext('2d');let W,H;const sy=()=>{W=cv.width;H=cv.height;};
  const V=4.6,C=2.3,MR=45;
  let rings=[],px=0,py=0,eA=0,trail=[],stars=[];const NS=120;

  function initStars(){stars=[];for(let i=0;i<NS;i++)stars.push({x:rnd(0,W),y:rnd(0,H),len:rnd(4,40),speed:rnd(3,14),a:rnd(0.2,0.9)});}

  return{
    init(){sy();rings=[];trail=[];px=-100;py=H/2;eA=0;initStars();},
    onResize(){sy();py=H/2;initStars();},
    draw(dt,t){
      sy();ctx.fillStyle='#010418';ctx.fillRect(0,0,W,H);
      const bg=ctx.createRadialGradient(W*0.5,H*0.35,0,W*0.5,H*0.5,H*0.8);
      bg.addColorStop(0,'rgba(0,15,60,.4)');bg.addColorStop(1,'rgba(0,0,0,0)');ctx.fillStyle=bg;ctx.fillRect(0,0,W,H);

      // warp starfield — streaks from particle direction
      const speed=V;
      stars.forEach(s=>{
        s.x+=s.speed*dt*(speed/4.6);
        if(s.x>W+50)s.x=-50;
        ctx.strokeStyle=`rgba(180,210,255,${s.a})`;ctx.lineWidth=0.7;
        ctx.beginPath();ctx.moveTo(s.x,s.y);ctx.lineTo(s.x-s.len*(s.speed/14),s.y);ctx.stroke();
      });

      const pvx=px,pvy=py;px+=V*dt;py=H/2+Math.sin(t*0.28)*H*0.06;
      if(px>W+150){px=-100;py=H/2+rnd(-H*0.06,H*0.06);rings=[];trail=[];}
      trail.push({x:pvx,y:pvy,a:1});if(trail.length>55)trail.shift();
      trail.forEach(pt=>{pt.a=clamp(pt.a-0.018*dt,0,1);});
      ctx.lineCap='round';
      for(let i=1;i<trail.length;i++){const a=trail[i].a*(0.04+i/trail.length*0.36);ctx.strokeStyle=`rgba(80,190,255,${a.toFixed(3)})`;ctx.lineWidth=3*(i/trail.length);ctx.shadowColor='rgba(60,160,255,.5)';ctx.shadowBlur=8;ctx.beginPath();ctx.moveTo(trail[i-1].x,trail[i-1].y);ctx.lineTo(trail[i].x,trail[i].y);ctx.stroke();}ctx.shadowBlur=0;
      eA+=dt;if(eA>=20/60*60&&rings.length<MR){rings.push({ox:px,oy:py,r:0});eA=0;}
      rings.forEach(r=>{r.r+=C*dt;});
      /* [FIX] filter→인플레이스 역방향 splice */
      for(let _i=rings.length-1;_i>=0;_i--){if(rings[_i].r>=W*1.6)rings.splice(_i,1);}
      rings.sort((a,b)=>b.r-a.r);
      rings.forEach(rr=>{const age=rr.r/(W*1.6),al=clamp(0.75-age*0.75,0,1),iA=al*0.4;ctx.beginPath();ctx.arc(rr.ox,rr.oy,rr.r,0,TAU);ctx.strokeStyle=`rgba(35,140,255,${al.toFixed(3)})`;ctx.lineWidth=1.2;ctx.shadowColor='rgba(0,120,255,.6)';ctx.shadowBlur=14;ctx.stroke();ctx.shadowBlur=0;ctx.beginPath();ctx.arc(rr.ox,rr.oy,rr.r*0.98,0,TAU);ctx.strokeStyle=`rgba(120,200,255,${iA.toFixed(3)})`;ctx.lineWidth=0.5;ctx.stroke();});
      if(rings.length>2){const mu=Math.asin(clamp(C/V,0,1)),len=W*1.4;ctx.save();ctx.beginPath();ctx.moveTo(px,py);ctx.lineTo(px-len*Math.cos(mu),py-len*Math.sin(mu));ctx.lineTo(px-len*Math.cos(mu),py+len*Math.sin(mu));ctx.closePath();const cg=ctx.createLinearGradient(px,py,px-len*Math.cos(mu),py);cg.addColorStop(0,'rgba(20,100,255,.15)');cg.addColorStop(.5,'rgba(0,60,180,.07)');cg.addColorStop(1,'transparent');ctx.fillStyle=cg;ctx.fill();ctx.restore();}
      const pg=ctx.createRadialGradient(px,py,0,px,py,38);pg.addColorStop(0,'rgba(255,255,255,1)');pg.addColorStop(.15,'rgba(160,220,255,.9)');pg.addColorStop(.45,'rgba(60,150,255,.4)');pg.addColorStop(1,'transparent');ctx.fillStyle=pg;ctx.fillRect(px-38,py-38,76,76);

      // chromatic aberration edge vignette
      const ce=ctx.createRadialGradient(W/2,H/2,H*0.3,W/2,H/2,H*0.8);ce.addColorStop(0,'transparent');ce.addColorStop(0.75,'transparent');ce.addColorStop(1,'rgba(255,0,0,.12)');ctx.fillStyle=ce;ctx.fillRect(0,0,W,H);
      const ce2=ctx.createRadialGradient(W/2+4,H/2+2,H*0.3,W/2+4,H/2+2,H*0.8);ce2.addColorStop(0,'transparent');ce2.addColorStop(0.75,'transparent');ce2.addColorStop(1,'rgba(0,255,255,.10)');ctx.fillStyle=ce2;ctx.fillRect(0,0,W,H);
      // dark vignette
      const vg=ctx.createRadialGradient(W/2,H/2,H*0.06,W/2,H/2,H*0.74);vg.addColorStop(0,'transparent');vg.addColorStop(1,'rgba(0,0,18,.9)');ctx.fillStyle=vg;ctx.fillRect(0,0,W,H);
      ctx.font='400 8px "Space Mono",monospace';ctx.fillStyle='rgba(80,180,255,.22)';ctx.textAlign='right';ctx.fillText(`Ma ${(V/C).toFixed(2)}  |  th ${(Math.asin(C/V)*180/PI).toFixed(1)}deg`,W-18,H-16);ctx.textAlign='left';
    },
    cleanup(){rings=[];trail=[];stars=[];}
  };
}

/* ============================================================
   10 · CELLULAR BONDS — Overload Burst + Click Ping
   ============================================================ */

  /* ===== VFX-V5 · v5-08 ===== */
  function v5_m10(cv){
  const ctx=cv.getContext('2d');let W,H;const sy=()=>{W=cv.width;H=cv.height;};
  const MN=20,MP=120;
  let nodes=[],edges=[],packets=[],pA=0;
  const OVERLOAD_THRESH=12;// packets received before burst

  class Node{
    constructor(id){this.id=id;this.x=rnd(W*0.1,W*0.9);this.y=rnd(H*0.1,H*0.9);this.vx=rnd(-0.22,0.22);this.vy=rnd(-0.15,0.15);this.r=rnd(10,18);this.hue=rnd(140,200);this.phase=rnd(0,TAU);this.pulse=1;this.rf=0;this.cnt=0;this.overloaded=false;this.overloadT=0;this.burstCooldown=0;}
    update(dt,t){
      this.x+=this.vx*dt;this.y+=this.vy*dt;
      if(this.x<this.r+10){this.x=this.r+10;this.vx=Math.abs(this.vx);}if(this.x>W-this.r-10){this.x=W-this.r-10;this.vx=-Math.abs(this.vx);}
      if(this.y<this.r+10){this.y=this.r+10;this.vy=Math.abs(this.vy);}if(this.y>H-this.r-10){this.y=H-this.r-10;this.vy=-Math.abs(this.vy);}
      this.pulse=0.8+0.2*Math.sin(t*2.8+this.phase);this.hue=(this.hue+0.025*dt)%360;
      this.rf=Math.max(0,this.rf-dt*0.055);this.burstCooldown=Math.max(0,this.burstCooldown-dt);
      if(this.overloaded){this.overloadT+=dt;if(this.overloadT>1.2){this.overloaded=false;this.overloadT=0;this.cnt=0;}}
    }
    recv(){
      this.rf=1;this.cnt++;
      if(this.cnt>=OVERLOAD_THRESH&&!this.overloaded&&this.burstCooldown<=0){this.overloaded=true;this.overloadT=0;this.burstCooldown=8;this.burst();}
    }
    burst(){
      edges.forEach(([a,b])=>{
        const other=(a===this.id)?b:(b===this.id?a:-1);
        if(other<0)return;
        for(let k=0;k<3;k++){if(packets.length<MP+30)packets.push(new Packet(this.id,other,true));}
      });
    }
    draw(){
      const pr=this.r*(1+0.12*this.pulse);
      const nodeHue=this.overloaded?0:this.hue;
      const pg=ctx.createRadialGradient(this.x,this.y,0,this.x,this.y,pr*2.4);
      pg.addColorStop(0,`hsla(${nodeHue},100%,78%,${(0.16+this.rf*0.38).toFixed(3)})`);
      pg.addColorStop(.5,`hsla(${nodeHue},100%,55%,${(0.05+this.rf*0.14).toFixed(3)})`);
      pg.addColorStop(1,'transparent');
      ctx.beginPath();ctx.arc(this.x,this.y,pr*2.4,0,TAU);ctx.fillStyle=pg;ctx.fill();
      ctx.beginPath();ctx.arc(this.x,this.y,pr,0,TAU);
      ctx.fillStyle=`hsla(${nodeHue+15},92%,82%,${(0.72+this.rf*0.28).toFixed(3)})`;
      ctx.shadowColor=this.overloaded?'rgba(255,0,0,.9)':`hsl(${nodeHue},100%,65%)`;
      ctx.shadowBlur=this.overloaded?30+Math.sin(this.overloadT*20)*10:14+this.rf*22;ctx.fill();ctx.shadowBlur=0;
      if(this.rf>0.08){const fr=pr*(1+this.rf*3);ctx.beginPath();ctx.arc(this.x,this.y,fr,0,TAU);ctx.strokeStyle=`hsla(${nodeHue},100%,88%,${(this.rf*0.65).toFixed(3)})`;ctx.lineWidth=2;ctx.stroke();}
      if(this.overloaded){
        const br=pr*(2+this.overloadT*3);
        ctx.beginPath();ctx.arc(this.x,this.y,br,0,TAU);ctx.strokeStyle=`rgba(255,60,60,${Math.max(0,0.8-this.overloadT).toFixed(3)})`;ctx.lineWidth=3;ctx.shadowColor='rgba(255,0,0,.8)';ctx.shadowBlur=20;ctx.stroke();ctx.shadowBlur=0;
      }
      // no counter display
    }
  }

  class Packet{
    constructor(n1,n2,isBurst){this.n1=n1;this.n2=n2;this.t=0;this.speed=rnd(0.014,0.030)*(isBurst?1.6:1);this.hue=nodes[n1]?nodes[n1].hue:160;if(isBurst)this.hue=0;this.size=rnd(3,6)*(isBurst?1.3:1);this.trail=[];this.done=false;this.burst=!!isBurst;}
    update(dt){
      this.t=Math.min(1,this.t+this.speed*dt);
      const n1=nodes[this.n1],n2=nodes[this.n2];if(!n1||!n2)return;
      const x=lerp(n1.x,n2.x,this.t),y=lerp(n1.y,n2.y,this.t);
      this.trail.push({x,y,a:1});if(this.trail.length>16)this.trail.shift();
      this.trail.forEach(p=>{p.a=Math.max(0,p.a-0.065);});
      if(this.t>=1&&!this.done){this.done=true;if(nodes[this.n2])nodes[this.n2].recv();}
    }
    draw(){
      const n1=nodes[this.n1],n2=nodes[this.n2];if(!n1||!n2)return;
      const x=lerp(n1.x,n2.x,this.t),y=lerp(n1.y,n2.y,this.t);
      for(let i=1;i<this.trail.length;i++){const p=this.trail[i],p0=this.trail[i-1],a=p.a*0.55;if(a<0.01)continue;ctx.strokeStyle=this.burst?`rgba(255,100,100,${a.toFixed(3)})`:`hsla(${this.hue},100%,75%,${a.toFixed(3)})`;ctx.lineWidth=this.size*0.55*(i/this.trail.length);ctx.lineCap='round';ctx.beginPath();ctx.moveTo(p0.x,p0.y);ctx.lineTo(p.x,p.y);ctx.stroke();}
      ctx.save();ctx.translate(x,y);ctx.rotate(this.t*PI*4.5);const s=this.size;ctx.beginPath();ctx.moveTo(0,-s);ctx.lineTo(s,0);ctx.lineTo(0,s);ctx.lineTo(-s,0);ctx.closePath();ctx.fillStyle=this.burst?'rgba(255,120,120,.98)':`hsla(${this.hue},100%,88%,.96)`;ctx.shadowColor=this.burst?'rgba(255,0,0,.9)':`hsl(${this.hue},100%,70%)`;ctx.shadowBlur=14;ctx.fill();ctx.shadowBlur=0;ctx.restore();
    }
  }

  function buildEdges(){edges=[];const TH=W*0.32;for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++){const dx=nodes[i].x-nodes[j].x,dy=nodes[i].y-nodes[j].y;if(Math.sqrt(dx*dx+dy*dy)<TH)edges.push([i,j]);}}

  function injectPing(mx,my){
    let best=-1,bestD=9e9;
    nodes.forEach((n,i)=>{const dx=n.x-mx,dy=n.y-my,d=dx*dx+dy*dy;if(d<bestD){bestD=d;best=i;}});
    if(best<0)return;
    edges.forEach(([a,b])=>{
      const other=(a===best)?b:(b===best?a:-1);if(other<0)return;
      for(let k=0;k<2;k++)if(packets.length<MP+30)packets.push(new Packet(best,other,false));
    });
    nodes[best].rf=1;
  }

  function setupClick(){
    const r=()=>cv.getBoundingClientRect();
    cv.addEventListener('click',e=>{const rc=r();injectPing((e.clientX-rc.left)*(W/rc.width),(e.clientY-rc.top)*(H/rc.height));});
    cv.addEventListener('touchend',e=>{e.preventDefault();const t2=e.changedTouches[0],rc=r();injectPing((t2.clientX-rc.left)*(W/rc.width),(t2.clientY-rc.top)*(H/rc.height));},{passive:false});
  }

  return{
    init(){sy();nodes=[];edges=[];packets=[];pA=0;for(let i=0;i<MN;i++)nodes.push(new Node(i));buildEdges();setupClick();},
    onResize(){sy();buildEdges();},
    draw(dt,t){
      sy();ctx.fillStyle='rgba(1,4,12,.15)';ctx.fillRect(0,0,W,H);
      if(Math.floor(t*2)%4===0&&dt>0.1)buildEdges();nodes.forEach(n=>n.update(dt,t));
      const actSet=new Set();packets.forEach(pk=>{actSet.add(`${Math.min(pk.n1,pk.n2)}_${Math.max(pk.n1,pk.n2)}`);});
      edges.forEach(([i,j])=>{
        const a=nodes[i],b=nodes[j],dx=a.x-b.x,dy=a.y-b.y,dist=Math.sqrt(dx*dx+dy*dy);if(dist>W*0.34)return;
        const key=`${Math.min(i,j)}_${Math.max(i,j)}`,isAct=actSet.has(key);
        const ba=(0.32-dist/(W*0.34)*0.28).toFixed(3);
        const eg=ctx.createLinearGradient(a.x,a.y,b.x,b.y);eg.addColorStop(0,`hsla(${a.hue},80%,58%,${ba})`);eg.addColorStop(1,`hsla(${b.hue},80%,58%,${ba})`);
        ctx.strokeStyle=eg;ctx.lineWidth=isAct?2.2:0.7;
        if(isAct){ctx.shadowColor=`hsl(${(a.hue+b.hue)/2},100%,68%)`;ctx.shadowBlur=12;}
        ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();ctx.shadowBlur=0;
      });
      pA+=dt;if(pA>3.5&&packets.length<MP&&edges.length>0){const cnt=rni(1,3);for(let k=0;k<cnt;k++){const e=edges[rni(0,edges.length-1)];packets.push(new Packet(Math.random()<0.5?e[0]:e[1],Math.random()<0.5?e[1]:e[0],false));}pA=0;}
      packets.forEach(p=>{p.update(dt);p.draw();});
      /* [FIX] filter→인플레이스 역방향 splice */
      for(let _i=packets.length-1;_i>=0;_i--){if(packets[_i].done)packets.splice(_i,1);}
      nodes.forEach(n=>n.draw());
      ctx.font='400 8px "Space Mono",monospace';ctx.textAlign='left';ctx.fillStyle='rgba(0,220,180,.22)';ctx.fillText(`BONDS: ${edges.length}  PACKETS: ${packets.length}`,14,H-14);
      const vg=ctx.createRadialGradient(W/2,H/2,H*0.09,W/2,H/2,H*0.72);vg.addColorStop(0,'transparent');vg.addColorStop(1,'rgba(0,0,0,.76)');ctx.fillStyle=vg;ctx.fillRect(0,0,W,H);
    },
    cleanup(){nodes=[];edges=[];packets=[];}
  };
}

    document.addEventListener('DOMContentLoaded',()=>{
      v5mount('cv-v5-01','ov-v5-01','pu-v5-01',v5_m1);
      v5mount('cv-v5-02','ov-v5-02','pu-v5-02',v5_m2);
      v5mount('cv-v5-03','ov-v5-03','pu-v5-03',v5_m4);
      v5mount('cv-v5-04','ov-v5-04','pu-v5-04',v5_m5);
      v5mount('cv-v5-05','ov-v5-05','pu-v5-05',v5_m7);
      v5mount('cv-v5-06','ov-v5-06','pu-v5-06',v5_m8);
      v5mount('cv-v5-07','ov-v5-07','pu-v5-07',v5_m9);
      v5mount('cv-v5-08','ov-v5-08','pu-v5-08',v5_m10);
    });

  /* ── VFX GAME INTEGRATION: Phase 0 effect registration ─────────────── */
  if (typeof window.VFX !== 'undefined') {
    // FX 계열 (frame(d, dt_초) adapter)
    window.VFX._bulkFX({
      'FX01':FX1,'FX02':FX2,'FX03':FX3,'FX04':FX4,'FX05':FX5,
      'FX06':FX6,'FX07':FX7,'FX08':FX8,'FX09':FX9,'FX10':FX10,
      'FX11':FX11,'FX12':FX12,'FX13':FX13,'FX14':FX14,'FX15':FX15,
      'FX16':FX16,'FX17':FX17,'FX19':FX19,'FX20':FX20,'FX21':FX21,
      'FX22':FX22,'FX25':FX25,'FX28':FX28,'FX29':FX29,'FX30':FX30,
      'MC01':FXc1,'MC02':FXc2,'MC03':FXc3,'MC04':FXc4,'MC05':FXc5,'MC06':FXc6,
    });
    // INT 계열 (frame adapter)
    window.VFX._bulkFX({
      'INT01':intFX_INT1,'INT02':intFX_INT2,'INT03':intFX_INT3,
      'INT04':intFX_INT4,'INT05':intFX_INT5,'INT06':intFX_INT6,
      'INT07':intFX_INT7,'INT08':intFX_INT8,'INT09':intFX_INT9,
      'INT10':intFX_INT10,
    });
    // NV 계열 (frame adapter)
    window.VFX._bulkFX({
      'NV01':FXN36,'NV02':FXN37,'NV03':FXN38,'NV04':FXN39,
      'NV06':FXN41,'NV07':FXN42,'NV08':FXN43,'NV09':FXN44,
      'NV10':FXN45,'NV11':FXN51,'NV12':FXN52,
    });
    // V5 계열 (draw(dt_프레임, t_초) → wrapV5가 초→프레임 변환)
    window.VFX._bulkV5({
      'V5-01':v5_m1,'V5-02':v5_m2,'V5-03':v5_m4,'V5-04':v5_m5,
      'V5-05':v5_m7,'V5-06':v5_m8,'V5-07':v5_m9,'V5-08':v5_m10,
    });
    console.log('[VFX] Part-I registered:', window.VFX.list().length, 'effects');
    // FX 표시 번호 ↔ 모듈 번호 별칭 (data-did 기준)
    window.VFX._bulkAlias({
      'FX-18': 'FX19',  // data-did FX-18 → MAP["19"]=FX19 (display off-by-one)
      'FX-23': 'FX25',  // data-did FX-23 → MAP["23"]=FX25
      'FX-24': 'FX28',  // data-did FX-24 → MAP["24"]=FX28
      'NV-05': 'NV06',  // data-did NV-05 → FXN41 (등록명 NV06, display NV-05)
    });
    // AC 계열 — one-shot skillFn(canvas, onDone) 패턴
    window.VFX._bulkOneShot({
      'AC-01': sk1,
      'AC-02': sk5,
    });
  }
  /* ───────────────────────────────────────────────────────────────────── */

  })();

/* ── [GAME PATCH] AS-* 게임표시명 별칭 (원본 AS맵은 WebGL블록에 있어 발췌)
   번들 내 2D 타겟만. AS-06(→FX35)은 번들 밖 → P2/P3에서 처리 ── */
if (typeof window.VFX !== 'undefined' && window.VFX._bulkAlias) {
  window.VFX._bulkAlias({
    'AS-03': 'FX28',   // as-03 (불+흙)
    'AS-07': 'FX07',   // as-07
  });
}


/* ===== [3] three 브릿지 ===== */
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
