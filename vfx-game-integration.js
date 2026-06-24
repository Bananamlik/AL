/**
 * vfx-game-integration.js  ·  Phase 0 MUST items
 * ─────────────────────────────────────────────────
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
 *  로드 순서: 반드시 FX effect 스크립트보다 먼저 로드
 *  Usage:
 *    <script src="vfx-game-integration.js"></script>
 *    ... (기존 HTML 스크립트들) ...
 *    <script>
 *      // 게임 루프
 *      function gameLoop(now) {
 *        const dt = Math.min((now - last) * 0.001, 0.05);
 *        last = now;
 *        VFX.updateAll(dt);     // ← 모든 활성 이펙트
 *        requestAnimationFrame(gameLoop);
 *      }
 *    </script>
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
      inst.init({ canvas, W: canvas.width || 0, H: canvas.height || 0, DPR: _DPR });
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
