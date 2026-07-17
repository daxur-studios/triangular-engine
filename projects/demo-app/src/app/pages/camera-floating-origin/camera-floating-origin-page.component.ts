import { PercentPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { MatTooltip } from '@angular/material/tooltip';
import { Color, NoToneMapping, Vector3, type Vector3Tuple } from 'three';
import {
  CameraFollowController,
  EngineModule,
  EngineService,
  FloatingOrigin,
  OrbitControlsComponent,
} from 'triangular-engine';

type Scenario = 'ordinary' | 'rebase' | 'interstellar';

const ALPHA_CENTAURI_METRES = 4.0175e16;
// Approximate radius of Alpha Centauri A (about 1.223 solar radii).
const ALPHA_CENTAURI_A_RADIUS_METRES = 851_000_000;
const ARRIVAL_CLEARANCE_METRES = 2000000;
const INTERSTELLAR_ARRIVAL_METRES =
  ALPHA_CENTAURI_METRES -
  ALPHA_CENTAURI_A_RADIUS_METRES -
  ARRIVAL_CLEARANCE_METRES;
const REBASE_THRESHOLD = 1_000;

@Component({
  selector: 'app-camera-floating-origin-page',
  imports: [PercentPipe, RouterLink, MatTooltip, EngineModule],
  templateUrl: './camera-floating-origin-page.component.html',
  styleUrl: './camera-floating-origin-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    EngineService.provide({
      showFPS: true,
      toneMapping: NoToneMapping,
      webGLRendererParameters: { antialias: true },
    }),
  ],
  host: { class: 'flex-page' },
})
export class CameraFloatingOriginPageComponent {
  readonly scenario = signal<Scenario>('ordinary');
  readonly following = signal(true);
  readonly rebaseCount = signal(0);
  readonly speed = signal(0);
  readonly progress = signal(0);
  readonly travelDuration = signal(5);
  readonly localPosition = signal<Vector3Tuple>([0, 1.5, 0]);
  readonly milestoneFractions = Array.from(
    { length: 9 },
    (_, index) => (index + 1) / 10,
  );
  readonly milestonePositions = signal<readonly Vector3Tuple[]>(
    this.milestoneFractions.map<Vector3Tuple>((fraction) => [
      ALPHA_CENTAURI_METRES * fraction,
      1.5,
      0,
    ]),
  );
  readonly alphaCentauriPosition = signal<Vector3Tuple>([
    ALPHA_CENTAURI_METRES,
    1.5,
    0,
  ]);
  readonly alphaCentauriDistance = ALPHA_CENTAURI_METRES;
  readonly alphaCentauriRadius = ALPHA_CENTAURI_A_RADIUS_METRES;
  readonly arrivalClearance = ARRIVAL_CLEARANCE_METRES;
  readonly milestoneRadius = ALPHA_CENTAURI_METRES / 2_000;
  readonly cameraFar = ALPHA_CENTAURI_METRES * 2;
  readonly plumePosition = computed<Vector3Tuple>(() => {
    const [x, y, z] = this.localPosition();
    return [x - 3.4, y, z];
  });
  readonly progressMarkers = Array.from(
    { length: 11 },
    (_, index) => index / 10,
  );

  readonly scenarioTitle = computed(() => {
    switch (this.scenario()) {
      case 'ordinary':
        return 'Ordinary-scale control';
      case 'rebase':
        return 'Repeated synchronous rebases';
      case 'interstellar':
        return 'Alpha Centauri traversal';
    }
  });
  readonly worldDistance = signal(0);
  readonly localPositionLabel = computed(() =>
    this.localPosition()
      .map((value) => formatSigned(value))
      .join('  '),
  );
  readonly worldDistanceLabel = computed(() =>
    formatEngineeringDistance(this.worldDistance()),
  );

  private readonly engine = inject(EngineService);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly orbitRef = viewChild(OrbitControlsComponent);
  private readonly floatingOrigin = new FloatingOrigin({
    threshold: REBASE_THRESHOLD,
  });
  private readonly absolutePosition = new Vector3(0, 1.5, 0);
  private readonly velocity = new Vector3(65, 0, 40);
  private readonly renderPosition = new Vector3();
  private followController?: CameraFollowController;
  private elapsed = 0;
  private travelElapsed = 0;
  private travelling = false;

  constructor() {
    const destroyRef = inject(DestroyRef);
    const previousBackground = this.engine.scene.background;
    this.engine.scene.background = new Color('#050b12');
    destroyRef.onDestroy(() => {
      this.engine.scene.background = previousBackground;
    });

    const unsubscribe = this.floatingOrigin.onRebase((event) => {
      if (this.scenario() === 'interstellar') {
        // Interstellar frame deltas dwarf the camera offset. Re-seed the
        // controller in the new local frame instead of subtracting and adding
        // quadrillion-metre values around a metre-scale camera position.
        this.followController?.clear();
      } else {
        this.followController?.applyRebase(event);
      }
      this.rebaseCount.update((count) => count + 1);
    });
    destroyRef.onDestroy(unsubscribe);

    this.engine.tick$
      .pipe(takeUntilDestroyed(destroyRef))
      .subscribe((delta) => this.tick(Math.min(delta, 0.1)));
  }

  selectScenario(scenario: Scenario): void {
    this.scenario.set(scenario);
    this.absolutePosition.set(0, 1.5, 0);
    this.velocity.set(65, 0, 40);
    this.elapsed = 0;
    this.travelElapsed = 0;
    this.progress.set(0);
    this.floatingOrigin.reset();
    this.rebaseCount.set(0);
    this.travelling = false;
    this.followController?.clear();
    this.publishPosition(false);
  }

  toggleFollow(): void {
    this.following.update((value) => !value);
    if (this.following()) this.followController?.clear();
  }

  perturb(): void {
    this.velocity.add(new Vector3(420, 90, -310));
  }

  burstRebases(): void {
    if (this.scenario() !== 'rebase') this.selectScenario('rebase');
    for (let index = 0; index < 12; index++) {
      this.absolutePosition.x += REBASE_THRESHOLD * 1.25;
      this.publishPosition(true);
    }
  }

  startTravel(duration: number): void {
    if (this.scenario() !== 'interstellar') this.selectScenario('interstellar');
    this.travelDuration.set(duration);
    this.travelElapsed = 0;
    this.progress.set(0);
    this.travelling = true;
  }

  private tick(delta: number): void {
    this.ensureFollowController();
    if (delta <= 0) return;
    this.elapsed += delta;

    switch (this.scenario()) {
      case 'ordinary':
        this.stepOrdinary(delta);
        break;
      case 'rebase':
        this.stepRebase(delta);
        break;
      case 'interstellar':
        this.stepInterstellar(delta);
        break;
    }
  }

  private stepOrdinary(delta: number): void {
    const acceleration = new Vector3(
      Math.sin(this.elapsed * 0.73) * 55,
      Math.sin(this.elapsed * 1.17) * 18,
      Math.cos(this.elapsed * 0.51) * 55,
    );
    this.velocity.addScaledVector(acceleration, delta).multiplyScalar(0.998);
    this.absolutePosition.addScaledVector(this.velocity, delta);
    for (const axis of ['x', 'z'] as const) {
      if (Math.abs(this.absolutePosition[axis]) > 480) {
        this.absolutePosition[axis] =
          Math.sign(this.absolutePosition[axis]) * 480;
        this.velocity[axis] *= -0.9;
      }
    }
    this.absolutePosition.y = 8 + Math.sin(this.elapsed * 1.4) * 6;
    this.publishPosition(false);
  }

  private stepRebase(delta: number): void {
    const multiplier = 1 + 7 * (0.5 + 0.5 * Math.sin(this.elapsed * 0.8));
    this.absolutePosition.x += 360 * multiplier * delta;
    this.absolutePosition.z = Math.sin(this.elapsed * 0.35) * 350;
    this.publishPosition(true);
  }

  private stepInterstellar(delta: number): void {
    if (!this.travelling) return;
    this.travelElapsed = Math.min(
      this.travelDuration(),
      this.travelElapsed + delta,
    );
    const nextProgress = this.travelElapsed / this.travelDuration();
    this.progress.set(nextProgress);
    this.absolutePosition.set(
      INTERSTELLAR_ARRIVAL_METRES * nextProgress,
      1.5,
      0,
    );
    this.publishPosition(true);
    if (nextProgress >= 1) this.travelling = false;
  }

  private ensureFollowController(): void {
    if (this.followController) return;
    const orbitComponent = this.orbitRef();
    const orbit = orbitComponent?.orbitControls();
    if (!orbitComponent || !orbit) return;
    this.followController = new CameraFollowController(
      orbitComponent.internalCamera,
      orbit.target,
    );
    this.publishPosition(false);
  }

  private publishPosition(allowRebase: boolean): void {
    if (allowRebase) this.floatingOrigin.rebaseIfNeeded(this.absolutePosition);
    this.floatingOrigin.toLocal(this.absolutePosition, this.renderPosition);
    const origin = this.floatingOrigin.origin;
    this.milestonePositions.set(
      this.milestoneFractions.map<Vector3Tuple>((fraction) => [
        ALPHA_CENTAURI_METRES * fraction - origin.x,
        1.5 - origin.y,
        -origin.z,
      ]),
    );
    this.alphaCentauriPosition.set([
      ALPHA_CENTAURI_METRES - origin.x,
      1.5 - origin.y,
      -origin.z,
    ]);
    const tuple = this.renderPosition.toArray();
    this.localPosition.set(tuple);
    this.worldDistance.set(this.absolutePosition.length());
    this.speed.set(this.velocity.length());

    // The Three.js render happens immediately after tick$ and postTick$. Flush
    // Angular's template inputs now so both bound meshes reach the same frame.
    this.changeDetector.detectChanges();

    if (this.following()) this.followController?.update(this.renderPosition);
  }
}

function formatSigned(value: number): string {
  const safeValue = Math.abs(value) < 0.05 ? 0 : value;
  return `${safeValue >= 0 ? '+' : '-'}${Math.abs(safeValue)
    .toFixed(1)
    .padStart(6, ' ')}`;
}

function formatEngineeringDistance(metres: number): string {
  const units = ['m', 'km', 'Mm', 'Gm', 'Tm', 'Pm'] as const;
  if (!Number.isFinite(metres)) return '—';
  const magnitude = Math.abs(metres);
  const unitIndex = Math.min(
    units.length - 1,
    magnitude < 1 ? 0 : Math.floor(Math.log10(magnitude) / 3),
  );
  return `${(metres / 1000 ** unitIndex).toFixed(2)} ${units[unitIndex]}`;
}
