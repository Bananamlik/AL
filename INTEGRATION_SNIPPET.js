// ════════════════════════════════════════════════════════════════
// GlobeStriker v38-8 ← VFX 연동 스니펫 (ESM / jsDelivr)
// 메인게임 기초작업 완료 후 적용. 트레일모드 경로 무손상.
// ════════════════════════════════════════════════════════════════

// ── [1] 메인게임 <script type="module"> 상단, import 영역에 추가 ──────
//     ⚠ raw.githubusercontent 불가(MIME). jsDelivr 사용.
//     USER/REPO/BRANCH 치환.
import { VFX }            from 'https://cdn.jsdelivr.net/gh/USER/REPO@BRANCH/lib/vfx-game-integration.js';
import { VFXThreeBridge } from 'https://cdn.jsdelivr.net/gh/USER/REPO@BRANCH/lib/vfx-three-bridge.js';
import { FortressVFX }   from 'https://cdn.jsdelivr.net/gh/USER/REPO@BRANCH/lib/VFX3D_FORTRESS.js';
// (THREE/CANNON는 기존 importmap 그대로. 전역노출 불필요.)

// ── [2] 초기화 1회 (renderer/scene/camera 생성 직후) ────────────────
const vfxBridge = new VFXThreeBridge(renderer, scene, camera);
// 폭발효과 등록: 갱리에서 추출한 /effects/*.js 가 VFX.register 자동 호출.
//   await VFXLoader.load('https://cdn.jsdelivr.net/gh/USER/REPO@BRANCH/effects/impact-set.js')
//   또는 직접 VFX._bulkFX({...}).

// ── [3] missileStep() — 트레일 emit (메인게임 ~L8316 step%4 블록 옆) ──
//     기존 trailLine(THREE.Line) 은 유지 OR 대체. 1차는 병행 권장.
//   let _vfx3d = FortressVFX.spawn(projType, scene);   // 발사 시 1회 (fire ~L8219)
//   ...
//   if (step % 4 === 0) _vfx3d.emitTrail(pos, vel);    // pos=THREE.Vec3, vel=THREE.Vec3

// ── [4] 착탄 (메인게임 ~L8443 vfx2dSpawn('explosion') 옆) ─────────────
//   _vfx3d.burst(impactPos);                            // 3D 입자 폭발
//   FortressVFX.scheduleDispose(_vfx3d, scene, 2200);   // 페이드 후 정리
//   vfxBridge.spawnAtWorld('FX-89', impactPos);         // 2D 프리미엄 임팩트(추출효과명)
//   // 기존 vfx2dSpawn('explosion',...) 은 유지(병행) 또는 제거.

// ── [5] animate() — 프레임 업데이트 (메인게임 ~L6707, render 이전) ────
//   FortressVFX.update(deltaTime);   // dt = seconds
//   vfxBridge.update(deltaTime);     // VFX.updateAll + texture/overlay sync
//   renderer.render(scene, camera);

// ── [6] 게임 종료/리셋 (teardown) ───────────────────────────────────
//   FortressVFX.disposeAll(scene);
//   vfxBridge.dispose();
//   // _sharedMat 누수방지(REFERENCE #1): 완전 종료 시
//   //   import { VFX3DParticles } 후 별도 노출하거나, VFX3D 전역에서 1회 dispose.

// ── 주의 (REFERENCE.md) ─────────────────────────────────────────────
//  · B4 구면중력: FORTRESS-1.js 중력=Y-up. fortress 구면(radial)과 불일치.
//    1차안=입자수명 단축으로 회피. 정밀화=update() 중력벡터를 radial로 치환.
//  · B6 FORT_SCALE=0.015: earthRadius 월드 기준 입자크기 재튜닝 가능성.
//  · CANNON.Vec3 → emitTrail에 duck-typing(x/y/z) OK. .clone() 필요시
//    new THREE.Vector3().copy(missileBody.position).
