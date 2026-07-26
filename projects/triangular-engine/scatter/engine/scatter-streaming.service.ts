import { DestroyRef, Injectable, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { BehaviorSubject } from 'rxjs';
import { Vector3 } from 'three';
import { EngineService } from 'triangular-engine';
import type {
  IHierarchicalTerrainSurfaceDomain,
  TerrainVector3,
} from 'triangular-engine/terrain';
import {
  bucketScatterInstancesByLod,
  type IBucketScatterInstancesByLodOptions,
  type IScatterLodBucketingResult,
} from '../terrain/scatter-lod-batches';
import {
  selectFixedLevelScatterCells,
  type ISelectFixedLevelScatterCellsOptions,
} from '../terrain/scatter-terrain-cells';

export type ScatterStreamingViewpoint = readonly [number, number, number];
export type ScatterStreamingViewpointProvider = () => ScatterStreamingViewpoint;

/**
 * Engine-aware render-streaming facade for scatter.
 *
 * The active engine camera is the default viewpoint. Games can override it
 * with a fixed tuple or provider when render residency should follow a player,
 * editor cursor, spectator, or another camera.
 *
 * Provide this service in the same injector as `EngineService`.
 */
@Injectable()
export class ScatterStreamingService {
  private readonly engine = inject(EngineService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly scratchCameraWorld = new Vector3();
  private viewpointOverride:
    | ScatterStreamingViewpoint
    | ScatterStreamingViewpointProvider
    | undefined;
  private movementThresholdM = 1;

  private readonly viewpointSubject =
    new BehaviorSubject<ScatterStreamingViewpoint>(this.readViewpoint());

  /** Emits only when the viewpoint moves by at least `movementThresholdM`, or is forced. */
  readonly viewpointWorldM$ = this.viewpointSubject.asObservable();

  constructor() {
    this.engine.camera$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.update(true));
    this.engine.tick$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.update());
  }

  get viewpointWorldM(): ScatterStreamingViewpoint {
    return this.viewpointSubject.value;
  }

  get movementThreshold(): number {
    return this.movementThresholdM;
  }

  /**
   * Sets the minimum movement before streaming consumers are notified.
   * Defaults to one metre to avoid rebuilding render residency every frame.
   */
  setMovementThresholdM(value: number): void {
    if (!Number.isFinite(value) || value < 0) {
      throw new RangeError(
        'Scatter streaming movement threshold must be finite and non-negative.',
      );
    }
    this.movementThresholdM = value;
  }

  /**
   * Overrides camera-following. A provider is evaluated on every engine tick,
   * making it suitable for a moving player. Pass `undefined` to follow the
   * active camera again.
   */
  setViewpointOverride(
    override:
      | ScatterStreamingViewpoint
      | ScatterStreamingViewpointProvider
      | undefined,
  ): void {
    const previous = this.viewpointOverride;
    this.viewpointOverride = override;
    try {
      this.update(true);
    } catch (error) {
      this.viewpointOverride = previous;
      throw error;
    }
  }

  /** Re-reads the viewpoint and returns whether subscribers were notified. */
  update(force = false): boolean {
    const next = this.readViewpoint();
    const previous = this.viewpointSubject.value;
    const movedM = Math.hypot(
      next[0] - previous[0],
      next[1] - previous[1],
      next[2] - previous[2],
    );
    if (!force && movedM < this.movementThresholdM) return false;

    this.viewpointSubject.next([next[0], next[1], next[2]]);
    return true;
  }

  /** Buckets LODs around the current camera/override viewpoint. */
  bucketInstancesByLod(
    options: Omit<IBucketScatterInstancesByLodOptions, 'viewpointWorldM'>,
  ): IScatterLodBucketingResult {
    return bucketScatterInstancesByLod({
      ...options,
      viewpointWorldM: this.viewpointWorldM,
    });
  }

  /** Selects fixed identity cells around the current camera/override viewpoint. */
  selectFixedLevelCells<TAddress>(
    domain: IHierarchicalTerrainSurfaceDomain<TAddress>,
    options: Omit<
      ISelectFixedLevelScatterCellsOptions<TAddress>,
      'anchorWorldM'
    >,
  ): readonly TAddress[] {
    return selectFixedLevelScatterCells(domain, {
      ...options,
      anchorWorldM: this.viewpointWorldM as TerrainVector3,
    });
  }

  private readViewpoint(): ScatterStreamingViewpoint {
    const override =
      typeof this.viewpointOverride === 'function'
        ? this.viewpointOverride()
        : this.viewpointOverride;
    if (override) {
      this.assertFiniteViewpoint(override);
      return override;
    }

    this.engine.camera.getWorldPosition(this.scratchCameraWorld);
    return [
      this.scratchCameraWorld.x,
      this.scratchCameraWorld.y,
      this.scratchCameraWorld.z,
    ];
  }

  private assertFiniteViewpoint(viewpoint: ScatterStreamingViewpoint): void {
    if (!viewpoint.every(Number.isFinite)) {
      throw new RangeError(
        'Scatter streaming viewpoint must contain finite coordinates.',
      );
    }
  }
}
