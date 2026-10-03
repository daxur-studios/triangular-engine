import { Material } from 'three';
import { CSM } from 'three/examples/jsm/csm/CSM.js';

interface MaterialHooksBackup {
  originalOnBeforeCompile?: (shader: any, renderer: any) => void;
  originalCustomProgramCacheKey?: () => string;
}

/**
 * Enhanced CSM wrapper that preserves existing `material.onBeforeCompile` chains
 * and maintains reference counting when multiple scene objects share the same material.
 *
 * In vanilla Three.js CSM:
 * - `setupMaterial(material)` replaces `material.onBeforeCompile` directly, obliterating
 *   any wind, dither, billboard, or custom procedural hooks previously attached.
 * - `dispose()` deletes `material.onBeforeCompile` outright without restoring prior callbacks.
 *
 * `EngineCSM` safely composes callbacks by chaining the previous `onBeforeCompile`,
 * storing original hook backups in `material.userData`, and restoring them upon disposal.
 */
export class EngineCSM extends CSM {
  /** Reference counter tracking how many active meshes utilize each registered material */
  private readonly materialRefCounts = new Map<Material, number>();

  /** Backed up original callbacks prior to CSM injection */
  private readonly materialHookBackups = new Map<Material, MaterialHooksBackup>();

  /**
   * Safely registers a material with CSM support.
   * If the material is already registered, increments its reference count without re-wrapping.
   */
  override setupMaterial(material: Material): void {
    const currentRefs = this.materialRefCounts.get(material) ?? 0;
    this.materialRefCounts.set(material, currentRefs + 1);

    if (currentRefs > 0 && this.shaders.has(material)) {
      // Already injected
      return;
    }

    // Preserve previous onBeforeCompile & customProgramCacheKey (raw references without .bind)
    const previousOnBeforeCompile = material.onBeforeCompile;
    const previousCacheKey = material.customProgramCacheKey;

    this.materialHookBackups.set(material, {
      originalOnBeforeCompile: previousOnBeforeCompile,
      originalCustomProgramCacheKey: previousCacheKey,
    });

    // Run base Three.js CSM setup (which sets defines, uniforms, and onBeforeCompile)
    super.setupMaterial(material);

    const csmOnBeforeCompile = material.onBeforeCompile;

    // Compose previous hook with CSM hook
    material.onBeforeCompile = (shader: any, renderer: any) => {
      // Execute previous pipeline first (e.g. wind, vertex animation, dither)
      if (previousOnBeforeCompile) {
        previousOnBeforeCompile(shader, renderer);
      }
      // Execute CSM shader enhancements second
      if (csmOnBeforeCompile) {
        csmOnBeforeCompile(shader, renderer);
      }
    };

    // Compose cache key bound to material instance
    material.customProgramCacheKey = () => {
      const baseKey = previousCacheKey ? previousCacheKey.call(material) : '';
      return `${baseKey}|csm_${this.cascades}_${this.fade ? 1 : 0}`;
    };

    material.needsUpdate = true;
  }

  /**
   * Overrides updateFrustums to protect against degenerate/infinite camera far values
   * (e.g. Number.MAX_SAFE_INTEGER frequently used in OrbitControls).
   * Inverting a perspective projection matrix with an infinite far produces NaNs in CSMFrustum,
   * which would cause all cascade shadow cameras to collapse and plunge the scene into darkness.
   */
  override updateFrustums(): void {
    const camera = this.camera as any;
    const origFar = camera?.far;
    const isPerspective = camera?.isPerspectiveCamera;
    const needsClamp = isPerspective && (!Number.isFinite(origFar) || origFar > 100000);

    if (needsClamp) {
      camera.far = Math.max(2000, this.maxFar * 2);
      camera.updateProjectionMatrix();
    }

    try {
      super.updateFrustums();
    } finally {
      if (needsClamp) {
        camera.far = origFar;
        camera.updateProjectionMatrix();
      }
    }
  }

  /**
   * Overrides update to protect against degenerate camera far values when computing fade margins.
   */
  override update(): void {
    const camera = this.camera as any;
    const origFar = camera?.far;
    const isPerspective = camera?.isPerspectiveCamera;
    const needsClamp = isPerspective && (!Number.isFinite(origFar) || origFar > 100000);

    if (needsClamp) {
      camera.far = Math.max(2000, this.maxFar * 2);
    }

    try {
      super.update();
    } finally {
      if (needsClamp) {
        camera.far = origFar;
      }
    }
  }

  /**
   * Decrements registration count for a material, cleaning it up only when all referencing meshes are gone.
   */
  unregisterMaterial(material: Material): void {
    const currentRefs = this.materialRefCounts.get(material);
    if (currentRefs === undefined) {
      return;
    }

    if (currentRefs > 1) {
      this.materialRefCounts.set(material, currentRefs - 1);
      return;
    }

    // Last reference reached: unregister
    this.materialRefCounts.delete(material);
    this.cleanupSingleMaterial(material);
  }

  /**
   * Safely restores a single material to its original pre-CSM state.
   */
  private cleanupSingleMaterial(material: Material): void {
    const backup = this.materialHookBackups.get(material);
    this.materialHookBackups.delete(material);

    this.shaders.delete(material);

    delete (material as any).defines?.USE_CSM;
    delete (material as any).defines?.CSM_CASCADES;
    delete (material as any).defines?.CSM_FADE;

    // Note: Do NOT delete properties from shader.uniforms here.
    // Three.js WebGLUniforms.upload expects active uniforms from the compiled program
    // to remain accessible until the material is recompiled.

    if (backup?.originalOnBeforeCompile) {
      material.onBeforeCompile = backup.originalOnBeforeCompile;
    } else {
      delete (material as any).onBeforeCompile;
    }

    if (backup?.originalCustomProgramCacheKey) {
      material.customProgramCacheKey = backup.originalCustomProgramCacheKey;
    } else {
      delete (material as any).customProgramCacheKey;
    }

    material.needsUpdate = true;
  }

  /**
   * Disposes the CSM instance, restoring all registered materials to their original states.
   */
  override dispose(): void {
    for (const [material] of this.materialHookBackups) {
      this.cleanupSingleMaterial(material);
    }

    this.materialRefCounts.clear();
    this.materialHookBackups.clear();
    super.dispose();
  }
}
