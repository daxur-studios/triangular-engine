import {
  BoxGeometry,
  DirectionalLight,
  Mesh,
  MeshStandardMaterial,
} from 'three';
import { EngineService } from 'triangular-engine';

export interface ISpikeTemplateDiagnostics {
  readonly drawCalls: number;
  readonly triangles: number;
}

export interface ISpikeTemplateSceneHandle {
  setWireframe(enabled: boolean): void;
  dispose(): void;
}

/**
 * TEMPLATE — replace the body of this function with the actual mechanism
 * under test (custom geometry/shader/instancing/whatever the spike exists to
 * falsify). Keep the shape of this file: a plain factory that takes the
 * `EngineService` an existing `<scene>` already created and adds/updates
 * objects on it — it does NOT create its own renderer, camera, controls, or
 * requestAnimationFrame loop. `<scene>` (wired up in the sibling
 * `*.component.ts`) already owns all of that, plus the `showFPS` overlay.
 *
 * Rules this file exists to enforce (see ../../AGENTS.md for the full
 * writeup of *why*, including the bug this template was created to prevent):
 * - Add objects via `engine.scene.add(...)`. Use declarative components
 *   (`<directionalLight>`, `<ambientLight>`, `<orbitControls>`, ...) in the
 *   template for anything that already has one; reach for imperative
 *   `engine.scene.add()` only for objects with no declarative component
 *   (custom `BufferGeometry`, `InstancedMesh`, etc.) — exactly as this file
 *   does for its placeholder box.
 * - Drive per-frame logic off `engine.tick$.subscribe(...)`, never your own
 *   `requestAnimationFrame`.
 * - Read the active camera via `engine.camera$.value` (it can be `null` for
 *   a frame or two before `<orbitControls>` finishes initializing — always
 *   null-check it).
 * - Expose a `setWireframe()` that flips `material.wireframe` on YOUR OWN
 *   material directly. Never wire a shader-under-test's wireframe toggle to
 *   `<scene>`'s `[wireframe]` input — that input replaces the whole material
 *   with a generic green debug material (see `SceneMaterialOverride`),
 *   which hides the actual vertex/fragment output you're trying to inspect.
 */
export function createSpikeTemplateScene(
  engine: EngineService,
  onDiagnostics: (diagnostics: ISpikeTemplateDiagnostics) => void,
): ISpikeTemplateSceneHandle {
  engine.scene.add(new DirectionalLight('#ffffff', 1.2));

  const material = new MeshStandardMaterial({ color: '#3d7bd6' });
  const mesh = new Mesh(new BoxGeometry(1, 1, 1), material);
  mesh.name = 'spike-template-placeholder';
  engine.scene.add(mesh);

  let lastSampleMs = 0;
  const tickSubscription = engine.tick$.subscribe((deltaSeconds) => {
    mesh.rotation.y += deltaSeconds;

    const nowMs = performance.now();
    if (nowMs - lastSampleMs >= 500) {
      lastSampleMs = nowMs;
      onDiagnostics({
        drawCalls: engine.renderer.info.render.calls,
        triangles: engine.renderer.info.render.triangles,
      });
    }
  });

  return {
    setWireframe(enabled: boolean): void {
      material.wireframe = enabled;
    },
    dispose(): void {
      tickSubscription.unsubscribe();
      engine.scene.remove(mesh);
      mesh.geometry.dispose();
      material.dispose();
    },
  };
}
