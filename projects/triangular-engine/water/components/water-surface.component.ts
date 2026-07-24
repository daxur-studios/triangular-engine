import {
  Component,
  DestroyRef,
  effect,
  inject,
  input,
  OnDestroy,
  OnInit,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { WebGLRenderer } from 'three';
import { EngineService } from 'triangular-engine';
import {
  PlaneWaterDomain,
  type WaterSurfaceDomain,
} from '../core/water-domain';
import { WATER_WAVE_PRESETS } from '../core/wave-presets';
import {
  resolveWaterRenderPreset,
  WATER_RENDER_PRESETS,
  type WaterRenderPresetOverrides,
} from '../rendering/water-render-preset';
import { WaterSurfaceRenderer } from '../rendering/water-surface-renderer';

export type WaterQualityPresetName = keyof typeof WATER_RENDER_PRESETS;
export type WaterMotionPresetName = keyof typeof WATER_WAVE_PRESETS;

/**
 * Declarative owner of the shared water renderer.
 *
 * Quality and motion are intentionally independent so games can choose a
 * rendering budget without changing the character of the water.
 */
@Component({
  standalone: true,
  selector: 'waterSurface',
  template: '',
})
export class WaterSurfaceComponent implements OnInit, OnDestroy {
  private readonly engine = inject(EngineService);
  private readonly destroyRef = inject(DestroyRef);

  readonly domain = input<WaterSurfaceDomain>(new PlaneWaterDomain());
  readonly quality = input<WaterQualityPresetName>('balanced');
  readonly motion = input<WaterMotionPresetName>('oceanSwell');
  readonly presetOverrides = input<WaterRenderPresetOverrides>({});
  /**
   * Multiplies the camera-centred area retained at each LOD level.
   * Values above 1 keep finer geometry farther from the camera, at the cost
   * of more patch instances. This does not alter wave motion or surface size.
   */
  readonly lodDetail = input(1);
  readonly wireframe = input(false);

  private renderer: WaterSurfaceRenderer | undefined;
  private activeDomain: WaterSurfaceDomain | undefined;
  private currentWireframe = false;

  constructor() {
    effect(() => {
      const wireframe = this.wireframe();
      this.currentWireframe = wireframe;
      this.renderer?.setWireframe(wireframe);
    });

    effect(() => {
      const domain = this.domain();
      const quality = this.quality();
      const motion = this.motion();
      const overrides = this.presetOverrides();
      const lodDetail = this.lodDetail();
      const basePreset = resolveWaterRenderPreset(WATER_RENDER_PRESETS[quality], {
        ...overrides,
        waves: overrides.waves ?? WATER_WAVE_PRESETS[motion],
      });
      const detailMultiplier =
        Number.isFinite(lodDetail) && lodDetail > 0 ? lodDetail : 1;
      const preset = {
        ...basePreset,
        grid: {
          ...basePreset.grid,
          coreSizePatches: Math.max(
            4,
            Math.ceil(
              (basePreset.grid.coreSizePatches * detailMultiplier) / 4,
            ) * 4,
          ),
        },
      };

      if (this.renderer && this.activeDomain === domain) {
        this.renderer.setPreset(preset);
        return;
      }

      this.renderer?.dispose();
      this.renderer = new WaterSurfaceRenderer({
        domain,
        preset,
        wireframe: this.currentWireframe,
      });
      this.activeDomain = domain;
      this.renderer.addTo(this.engine.scene);
    });
  }

  ngOnInit(): void {
    this.engine.beforeRender$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        const renderer = this.renderer;
        if (!renderer) return;

        const camera = this.engine.camera;
        renderer.update(camera, this.engine.clock.getElapsedTime());
        if (this.engine.renderer instanceof WebGLRenderer) {
          renderer.captureDepth(
            this.engine.renderer,
            this.engine.scene,
            camera,
          );
        }
      });
  }

  ngOnDestroy(): void {
    this.renderer?.dispose();
    this.renderer = undefined;
    this.activeDomain = undefined;
  }
}
