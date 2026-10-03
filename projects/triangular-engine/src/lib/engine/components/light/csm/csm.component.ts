import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  Input,
  OnDestroy,
  OnInit,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import {
  Camera,
  Color,
  ColorRepresentation,
  DirectionalLight,
  Material,
  Object3D,
  Vector3,
  Vector3Tuple,
} from 'three';
import { CSMHelper } from 'three/examples/jsm/csm/CSMHelper.js';
import { EngineService } from '../../../services/engine.service';
import { calculateCsmAdaptiveRange } from './csm-adaptive-range';
import { forEachMeshMaterial, isCsmCompatibleMaterial } from './csm-material.util';
import { CsmAdaptiveRange, CsmSplitMode } from './csm.model';
import { EngineCSM } from './engine-csm';

const _dirVec = new Vector3();

/**
 * `<csm>` — Declarative Cascaded Shadow Maps component for Triangular Engine.
 *
 * Partitions the camera frustum into multiple depth cascades (e.g. 1 to 4) to eliminate
 * perspective aliasing and provide razor-sharp contact shadows near the camera while
 * maintaining deep horizons across open-world terrain.
 *
 * Seamlessly tracks `EngineService.camera$` across zoom, orbit, first-person, and third-person
 * cameras, with support for altitude-adaptive planetary scaling and live `[debug]` visual helpers.
 */
@Component({
  selector: 'csm',
  standalone: true,
  template: `<ng-content></ng-content>`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CsmComponent implements OnInit, OnDestroy {
  private readonly engineService = inject(EngineService);
  private readonly destroyRef = inject(DestroyRef);

  // ---------------------------------------------------------
  // Inputs
  // ---------------------------------------------------------
  readonly lightDirection = input<Vector3 | Vector3Tuple>([-1, -1.5, -1]);
  readonly color = input<string | ColorRepresentation>('#ffffff');
  readonly intensity = input<number>(3);
  readonly cascades = input<number>(4);
  readonly maxDistance = input<number>(500);
  readonly mode = input<CsmSplitMode>('practical');
  readonly shadowMapSize = input<number>(2048);
  readonly shadowBias = input<number>(-0.0001);
  readonly lightMargin = input<number>(200);
  readonly lightNear = input<number>(1);
  readonly lightFar = input<number>(2000);
  readonly fade = input<boolean>(true);
  readonly autoRegisterMaterials = input<boolean>(true);
  readonly adaptiveRange = input<CsmAdaptiveRange | undefined>(undefined);
  readonly debug = input<boolean>(false);

  // ---------------------------------------------------------
  // State
  // ---------------------------------------------------------
  private csmInstance: EngineCSM | null = null;
  private csmHelper: CSMHelper | null = null;
  private activeCamera: Camera | null = null;
  private baseIntensity = 3;
  private needsInitialScan = true;

  private sceneMutationListener: ((event: any) => void) | null = null;

  constructor() {
    this.initCameraTracking();
    this.initCSMRebuildEffect();
    this.initDynamicInputsEffect();
    this.initDebugHelperEffect();
    this.initTickUpdate();
  }

  ngOnInit(): void {
    this.enableRendererShadows();
    this.setupSceneGraphObserver();
  }

  ngOnDestroy(): void {
    this.teardownSceneGraphObserver();
    this.destroyCsmInstance();
  }

  // ---------------------------------------------------------
  // Public Material & Mesh Registration API
  // ---------------------------------------------------------
  /**
   * Registers a material for CSM shader enhancement.
   */
  registerMaterial(material: Material): void {
    if (!this.csmInstance || !isCsmCompatibleMaterial(material)) {
      return;
    }
    this.csmInstance.setupMaterial(material);
  }

  /**
   * Unregisters a material from CSM.
   */
  unregisterMaterial(material: Material): void {
    if (!this.csmInstance) {
      return;
    }
    this.csmInstance.unregisterMaterial(material);
  }

  /**
   * Traverses an Object3D and registers all compatible mesh materials.
   */
  registerObject(root: Object3D): void {
    if (!this.csmInstance) {
      return;
    }
    forEachMeshMaterial(root, (mat) => {
      this.registerMaterial(mat);
    });
  }

  /**
   * Traverses an Object3D and unregisters all mesh materials.
   */
  unregisterObject(root: Object3D): void {
    if (!this.csmInstance) {
      return;
    }
    forEachMeshMaterial(root, (mat) => {
      this.unregisterMaterial(mat);
    });
  }

  /**
   * Forces an immediate frustum calculation and shadow bounds update.
   */
  updateFrustums(): void {
    if (this.csmInstance) {
      this.csmInstance.updateFrustums();
    }
    if (this.csmHelper) {
      this.csmHelper.update();
    }
  }

  // ---------------------------------------------------------
  // Internal Lifecycle & Reactive Effects
  // ---------------------------------------------------------
  private enableRendererShadows(): void {
    const renderer = this.engineService.renderer;
    if (renderer && !renderer.shadowMap.enabled) {
      renderer.shadowMap.enabled = true;
    }
  }

  private initCameraTracking(): void {
    this.engineService.camera$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((camera) => {
        if (!camera || camera === this.activeCamera) {
          return;
        }
        this.activeCamera = camera;
        if (this.csmInstance) {
          this.csmInstance.camera = camera;
          this.csmInstance.updateFrustums();
        }
        if (this.csmHelper) {
          this.csmHelper.update();
        }
      });
  }

  private initCSMRebuildEffect(): void {
    // Structural changes (cascades count, shadowMapSize) require re-allocating CSM and shadow targets
    effect(() => {
      const cascades = this.cascades();
      const shadowMapSize = this.shadowMapSize();
      const mode = this.mode();
      const maxDistance = this.maxDistance();
      const lightMargin = this.lightMargin();
      const lightNear = this.lightNear();
      const lightFar = this.lightFar();

      // Trigger re-creation
      this.rebuildCSMInstance();
    });
  }

  private initDynamicInputsEffect(): void {
    // Dynamic parameters update live without instance re-allocation
    effect(() => {
      const dir = this.lightDirection();
      const colorVal = this.color();
      const intensityVal = this.intensity();
      const bias = this.shadowBias();
      const fadeVal = this.fade();

      if (!this.csmInstance) {
        return;
      }

      this.baseIntensity = intensityVal;
      this.csmInstance.shadowBias = bias;
      this.csmInstance.fade = fadeVal;

      // Update light direction
      if (Array.isArray(dir)) {
        _dirVec.set(dir[0], dir[1], dir[2]).normalize();
      } else {
        _dirVec.copy(dir).normalize();
      }
      this.csmInstance.lightDirection.copy(_dirVec);

      // Update light color and base intensity across cascade lights
      const colorObj = new Color(colorVal as any);
      for (const light of this.csmInstance.lights) {
        light.color.copy(colorObj);
        light.intensity = intensityVal;
        light.shadow.bias = bias;
      }

      this.csmInstance.updateFrustums();
    });
  }

  private initDebugHelperEffect(): void {
    effect(() => {
      const isDebug = this.debug();
      const scene = this.engineService.scene;

      if (!scene || !this.csmInstance) {
        return;
      }

      if (isDebug) {
        if (!this.csmHelper) {
          this.csmHelper = new CSMHelper(this.csmInstance);
          scene.add(this.csmHelper);
        }
      } else {
        if (this.csmHelper) {
          scene.remove(this.csmHelper);
          this.csmHelper = null;
        }
      }
    });
  }

  private initTickUpdate(): void {
    this.engineService.postTick$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        if (!this.csmInstance || !this.activeCamera) {
          return;
        }

        // Ensure materials added asynchronously by Angular children are captured
        if (this.autoRegisterMaterials() && this.needsInitialScan) {
          const scene = this.engineService.scene;
          if (scene) {
            this.registerObject(scene);
          }
          this.needsInitialScan = false;
        }

        // Apply altitude-adaptive planetary range if configured
        const adaptiveConfig = this.adaptiveRange();
        if (adaptiveConfig) {
          const adaptive = calculateCsmAdaptiveRange(
            this.activeCamera,
            adaptiveConfig,
          );
          if (this.csmInstance.maxFar !== adaptive.maxDistance) {
            this.csmInstance.maxFar = adaptive.maxDistance;
            this.csmInstance.updateFrustums();
          }

          // Attenuate light intensity when fading out to orbit
          const currentIntensity = this.baseIntensity * adaptive.shadowFactor;
          for (const light of this.csmInstance.lights) {
            light.intensity = currentIntensity;
          }
        }

        // Main frame update
        this.csmInstance.update();

        // Update debug helper if active
        if (this.csmHelper) {
          this.csmHelper.update();
        }
      });
  }

  private rebuildCSMInstance(): void {
    const scene = this.engineService.scene;
    const camera = this.activeCamera ?? this.engineService.camera;

    if (!scene || !camera) {
      return;
    }

    // Teardown previous instance
    this.destroyCsmInstance();

    // Resolve direction
    const dir = this.lightDirection();
    if (Array.isArray(dir)) {
      _dirVec.set(dir[0], dir[1], dir[2]).normalize();
    } else {
      _dirVec.copy(dir).normalize();
    }

    this.baseIntensity = this.intensity();

    // Instantiate EngineCSM
    this.csmInstance = new EngineCSM({
      camera,
      parent: scene,
      cascades: this.cascades(),
      maxFar: this.maxDistance(),
      mode: this.mode(),
      shadowMapSize: this.shadowMapSize(),
      shadowBias: this.shadowBias(),
      lightDirection: _dirVec.clone(),
      lightIntensity: this.baseIntensity,
      lightNear: this.lightNear(),
      lightFar: this.lightFar(),
      lightMargin: this.lightMargin(),
    });

    this.csmInstance.fade = this.fade();

    // Apply color to cascade lights
    const colorObj = new Color(this.color() as any);
    for (const light of this.csmInstance.lights) {
      light.color.copy(colorObj);
    }

    // Re-register scene materials if auto-register is enabled
    if (this.autoRegisterMaterials()) {
      this.registerObject(scene);
    }

    // Re-create helper if debug is true
    if (this.debug()) {
      this.csmHelper = new CSMHelper(this.csmInstance);
      scene.add(this.csmHelper);
    }

    this.csmInstance.updateFrustums();
  }

  private destroyCsmInstance(): void {
    if (this.csmHelper) {
      this.engineService.scene?.remove(this.csmHelper);
      this.csmHelper = null;
    }

    if (this.csmInstance) {
      this.csmInstance.remove();
      this.csmInstance.dispose();
      this.csmInstance = null;
    }
  }

  private setupSceneGraphObserver(): void {
    const scene = this.engineService.scene;
    if (!scene) {
      return;
    }

    this.sceneMutationListener = (event: any) => {
      if (!this.autoRegisterMaterials() || !this.csmInstance) {
        return;
      }
      const child = event?.child as Object3D;
      if (child) {
        this.registerObject(child);
      }
    };

    scene.addEventListener('childadded', this.sceneMutationListener);
  }

  private teardownSceneGraphObserver(): void {
    const scene = this.engineService.scene;
    if (scene && this.sceneMutationListener) {
      scene.removeEventListener('childadded', this.sceneMutationListener);
      this.sceneMutationListener = null;
    }
  }
}
