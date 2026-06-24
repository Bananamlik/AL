/**
 * vfx-game-build.js  ·  Phase 1 단일 루프 설정
 * ──────────────────────────────────────────────
 * 갤러리 showcase RAF 4개를 억제하고 VFX.createGameLoop() 로 대체.
 * 로드 순서: vfx-game-integration.js → (효과 스크립트) → vfx-game-build.js
 *
 * Usage (game context, NOT gallery showcase):
 *   <script src="vfx-game-integration.js"></script>
 *   <!-- effect scripts that auto-register via _bulkFX etc. -->
 *   <script src="vfx-game-build.js"></script>
 *   <script>
 *     VFXBuild.startGameLoop(dt => {
 *       myGame.update(dt);
 *       VFX.updateAll(dt);
 *       myRenderer.render();
 *       VFX.renderCanvas2D();
 *     });
 *   </script>
 */

'use strict';

const VFXBuild = (() => {
  /* ── 1. RAF suppression flags ─────────────────────────────
     갤러리 RAF 루프들이 시작되기 전에 플래그를 설정.
     각 IIFE에서 이 플래그를 확인하도록 패치가 필요하거나,
     루프가 이미 시작된 경우 cancellation으로 처리.
  ─────────────────────────────────────────────────────────── */
  const _flags = {
    suppressGallery: false,   // true → gallery RAF loops suppressed
    gameLoopActive:  false,
  };

  /* ── 2. Gallery RAF cancellation (post-start) ─────────────
     갤러리 showcase RAF가 이미 시작된 경우 취소.
     Call VFXBuild.suppressGalleryLoops() after DOMContentLoaded.
  ─────────────────────────────────────────────────────────── */
  function suppressGalleryLoops() {
    const win = window;
    // FX/INT/NV main loop
    if (win._rafId) { cancelAnimationFrame(win._rafId); win._rafId = 0; }
    // ARC loop
    if (win.arcRaf) { cancelAnimationFrame(win.arcRaf); win.arcRaf = 0; }
    // SW loop
    if (win.swRaf)  { cancelAnimationFrame(win.swRaf);  win.swRaf  = 0; }
    // GP loop
    if (win.gpRaf)  { cancelAnimationFrame(win.gpRaf);  win.gpRaf  = 0; }
    // V5 per-effect ticks: each v5 mount sets its own rafId inside the mount closure.
    // These can't be easily cancelled without modifying the V5 mount code.
    // → V5 effects in gallery mode continue running per-effect when visible.
    //   For game-only V5, use VFX.spawn('V5-01', ...) which uses wrapV5 + VFX.updateAll().
    _flags.suppressGallery = true;
    console.log('[VFXBuild] Gallery RAF loops suppressed. V5 per-effect ticks remain (gallery display only).');
  }

  /* ── 3. Game loop factory (wraps VFX.createGameLoop) ─────── */
  function startGameLoop(tickFn, opts = {}) {
    if (_flags.gameLoopActive) {
      console.warn('[VFXBuild] Game loop already running. Call stopGameLoop() first.');
      return null;
    }

    const loop = VFX.createGameLoop(dt => {
      tickFn(dt);
    });

    // Handle visibility
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) loop.stop();
      else loop.start();
    }, { passive: true });

    loop.start();
    _flags.gameLoopActive = true;
    console.log('[VFXBuild] Game loop started.');

    return {
      stop() {
        loop.stop();
        _flags.gameLoopActive = false;
        console.log('[VFXBuild] Game loop stopped.');
      },
      get running() { return loop.running; }
    };
  }

  /* ── 4. Effect catalogue ──────────────────────────────────── */
  /**
   * VFXBuild.catalogue()
   * Returns a categorized map of all registered effects.
   */
  function catalogue() {
    const all = VFX.list();
    const cats = {
      FX: [], MC: [], INT: [], NV: [], V5: [],
      AS: [], ARC: [], SW: [], GP: [], SC: [], AC: [],
      aliases: []
    };
    for (const name of all) {
      if      (name.startsWith('FX'))  cats.FX.push(name);
      else if (name.startsWith('MC'))  cats.MC.push(name);
      else if (name.startsWith('INT')) cats.INT.push(name);
      else if (name.startsWith('NV'))  cats.NV.push(name);
      else if (name.startsWith('V5'))  cats.V5.push(name);
      else if (name.startsWith('AS'))  cats.AS.push(name);
      else if (name.startsWith('ARC')) cats.ARC.push(name);
      else if (name.startsWith('SW'))  cats.SW.push(name);
      else if (name.startsWith('GP'))  cats.GP.push(name);
      else if (name.startsWith('SC'))  cats.SC.push(name);
      else if (name.startsWith('AC'))  cats.AC.push(name);
      else                             cats.aliases.push(name);
    }
    return cats;
  }

  /**
   * VFXBuild.printCatalogue()
   * Logs a formatted catalogue to the console.
   */
  function printCatalogue() {
    const cat = catalogue();
    const total = VFX.list().length;
    console.group(`[VFXBuild] Effect Catalogue — ${total} total`);
    for (const [key, arr] of Object.entries(cat)) {
      if (arr.length) console.log(`  ${key.padEnd(8)} (${arr.length}): ${arr.join(', ')}`);
    }
    console.groupEnd();
  }

  /* ── 5. Layer helper ──────────────────────────────────────── */
  /**
   * VFXBuild.mountOn(containerId, effectName, opts)
   * Quick-mount an effect on a container element by id.
   */
  function mountOn(containerId, effectName, opts = {}) {
    const container = document.getElementById(containerId);
    if (!container) { console.warn('[VFXBuild] container not found:', containerId); return null; }
    return VFX.spawn(effectName, { container, ...opts });
  }

  return {
    suppressGalleryLoops,
    startGameLoop,
    catalogue,
    printCatalogue,
    mountOn,
    get flags() { return { ..._flags }; }
  };
})();

window.VFXBuild = VFXBuild;

/* ── Auto-print catalogue after all scripts loaded ────────────────────────── */
if (document.readyState === 'complete') {
  setTimeout(() => VFXBuild.printCatalogue(), 100);
} else {
  window.addEventListener('load', () => setTimeout(() => VFXBuild.printCatalogue(), 200), { once: true });
}
