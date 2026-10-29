import { DestroyRef, effect, signal, untracked, type Signal } from '@angular/core';
import type { Camera, Object3D, PerspectiveCamera, Scene } from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import type { EngineService } from 'triangular-engine';
import { LodTerrainBody, type LodTerrainSettings, type LodView, type Vec3 } from 'triangular-engine/lod-surface/core';

/** What the terrain components read each time an input changes: the body's settings plus its debug and lighting switches. */
export interface LodTerrainInputs {
  readonly settings: LodTerrainSettings;
  readonly sunDirection: Vec3 | readonly [number, number, number];
  readonly view: LodView;
  readonly lighting: boolean;
  readonly bounds: boolean;
  readonly wireframe: boolean;
}

/** The terrain is shown after this long even if `compileAsync` has not answered; its first frame then pays the compile. */
const COMPILE_GUARD_MS = 60_000;

/** The part of `WebGPURenderer` used to warm a pipeline. */
interface CompilingRenderer {
  compileAsync?(object: Object3D, camera: Camera, targetScene: Scene): Promise<void>;
}

/**
 * Shared wiring of `<planetTerrain>` and `<flatTerrain>`; call it from a field initializer or constructor (it uses
 * `effect`). The body is made on the first run of the effect, when the required inputs are set, and added to the engine
 * scene. `read` may return `undefined` while the inputs are not enough to build the terrain (`<planetTerrain>` with no radius
 * from itself or a `<planet>`): nothing is built or changed then, and the effect runs again when what `read` used changes. Every frame, in `beforeRender$` (after camera controls have settled in `lateUpdate$`), it selects from the
 * active camera. On a renderer that is not `WebGPURenderer` the terrain stays hidden and does nothing.
 *
 * Each surface mesh (the first, and every one {@link LodTerrainBody.configure} makes after a setting changes its shader)
 * is first compiled with `renderer.compileAsync`, and the terrain stays hidden, still selecting, until that finishes. A new
 * material then costs a few hidden frames instead of one long first frame. A compile that fails or takes over a minute is
 * reported on `engine.error$` (phase `compile`) and the terrain is shown anyway.
 */
export function attachLodTerrain(engine: EngineService, destroyRef: DestroyRef, read: () => LodTerrainInputs | undefined): Signal<LodTerrainBody | undefined> {
  const terrain = signal<LodTerrainBody | undefined>(undefined);
  let body: LodTerrainBody | undefined;
  /** The surface mesh whose pipeline is built (or could not be: it is shown regardless). */
  let warmed: Object3D | undefined;
  /** The surface mesh whose `compileAsync` is pending; a rebuild replaces it, and the older answer is then ignored. */
  let warming: Object3D | undefined;
  let guard: ReturnType<typeof setTimeout> | undefined;
  let destroyed = false;

  effect(() => {
    const inputs = read();
    if (!inputs) return;
    untracked(() => {
      if (body) body.configure(inputs.settings);
      else {
        body = new LodTerrainBody(inputs.settings);
        body.object.visible = false;
        engine.scene.add(body.object);
        terrain.set(body);
      }
      body.setView(inputs.view);
      body.setLighting(inputs.lighting);
      body.setBounds(inputs.bounds);
      body.setWireframe(inputs.wireframe);
      body.setSun([inputs.sunDirection[0], inputs.sunDirection[1], inputs.sunDirection[2]]);
    });
  });

  const report = (error: unknown): void => {
    if (engine.error$) engine.error$.next({ phase: 'compile', error });
    else console.warn('[triangular-engine] LOD terrain pipeline compile failed:', error);
  };

  /**
   * Starts compiling `mesh`'s pipeline. The mesh itself is passed, not the body's group: the group is hidden and
   * `compileAsync` skips a hidden root, while the mesh stays visible inside it. It has no frustum culling, so it is
   * collected even before its first selection has set an instance count.
   */
  const warm = (renderer: CompilingRenderer, mesh: Object3D): void => {
    if (typeof renderer.compileAsync !== 'function') {
      warmed = mesh;
      return;
    }
    warming = mesh;
    clearTimeout(guard);
    const finish = (failure?: { readonly error: unknown }): void => {
      if (destroyed || warming !== mesh) return;
      clearTimeout(guard);
      warming = undefined;
      warmed = mesh;
      if (failure) report(failure.error);
    };
    guard = setTimeout(() => finish({ error: new Error(`Pipeline compilation did not finish in ${COMPILE_GUARD_MS / 1000} s`) }), COMPILE_GUARD_MS);
    try {
      renderer.compileAsync(mesh, engine.camera, engine.scene).then(() => finish(), (error: unknown) => finish({ error }));
    } catch (error) {
      finish({ error });
    }
  };

  const frame = engine.beforeRender$.subscribe(() => {
    if (!body) return;
    const renderer = engine.renderer as unknown as WebGPURenderer | null | undefined;
    const webgpu = renderer?.isWebGPURenderer === true;
    const mesh = body.surface.mesh;
    if (webgpu && warmed !== mesh && warming !== mesh) warm(renderer as unknown as CompilingRenderer, mesh);
    body.object.visible = webgpu && warmed === mesh;
    const camera = engine.camera as PerspectiveCamera;
    if (!webgpu || !camera.isPerspectiveCamera) return;
    body.update(camera, renderer?.domElement?.height || 1080);
  });

  destroyRef.onDestroy(() => {
    destroyed = true;
    clearTimeout(guard);
    frame.unsubscribe();
    body?.dispose();
    body = undefined;
    terrain.set(undefined);
  });
  return terrain.asReadonly();
}
