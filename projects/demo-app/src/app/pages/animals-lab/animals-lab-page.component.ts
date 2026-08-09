import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { EngineModule } from 'triangular-engine';
import { FixedStepClock, materializeFlock, presentInterpolatedFlock, stepFlock, updateFlockResidency, type FlockState } from 'triangular-engine/animals';

const terrain = { sample: (position: { x: number; y: number; z: number }) => ({ height: Math.sin(position.x * 0.08) * 0.4 + Math.cos(position.z * 0.06) * 0.3, normal: { x: 0, y: 1, z: 0 } }) };
const FLOCK_DEFINITION = { id: 'demo-birds', seed: 42, origin: { x: 0, y: 8, z: 0 }, count: 8, spacing: 7, speed: 4, cullDistance: 50, hysteresis: 12, habitatMinHeight: 5, habitatMaxHeight: 16, travelDirection: { x: 0.35, y: 0, z: 1 }, steeringAcceleration: 6, turnRate: 2.4, neighbourDistance: 11 };

@Component({
  selector: 'app-animals-lab-page',
  imports: [EngineModule],
  templateUrl: './animals-lab-page.component.html',
  styleUrl: './animals-lab-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [],
  host: { class: 'flex-page' },
})
export class AnimalsLabPageComponent {
  private readonly clock = new FixedStepClock(1 / 20, 240);
  private readonly destroyRef = inject(DestroyRef);
  readonly fleeing = signal(true);
  readonly vehicleZ = signal(-10);
  readonly timeScale = signal(1);
  readonly paused = signal(false);
  readonly skippedSeconds = signal(0);
  readonly simulationTime = signal(0);
  readonly observerX = signal(0);
  readonly flock = signal<FlockState[]>(materializeFlock(FLOCK_DEFINITION, { position: { x: 0, y: 0, z: 0 }, radius: 1 }));
  readonly previousFlock = signal<FlockState[]>(this.flock());
  readonly interpolationAlpha = signal(0);
  readonly residency = signal(updateFlockResidency(FLOCK_DEFINITION, { position: { x: 0, y: 0, z: 0 }, radius: 1 }));

  constructor() {
    const timer = window.setInterval(() => {
      const result = this.clock.advance(1 / 30, this.paused() ? 0 : this.timeScale());
      const observer = { position: { x: this.observerX(), y: 0, z: 0 }, radius: 1 };
      const residency = updateFlockResidency(FLOCK_DEFINITION, observer, this.residency().visible);
      let next = this.flock();
      let previous = this.previousFlock();
      if (residency.visible) for (let i = 0; i < result.steps; i += 1) {
        previous = next;
        next = stepFlock(next, this.clock.stepSeconds, FLOCK_DEFINITION.speed, terrain, this.fleeing() ? { id: 'vehicle', position: this.vehiclePosition(), radius: 18, strength: 8 } : undefined, FLOCK_DEFINITION);
      }
      this.flock.set(next);
      this.previousFlock.set(previous);
      this.interpolationAlpha.set(result.alpha);
      this.residency.set(residency);
      this.simulationTime.set(result.time);
      this.skippedSeconds.set(result.skippedSeconds);
    }, 33);
    this.destroyRef.onDestroy(() => window.clearInterval(timer));
  }

  presentation() { return this.residency().visible ? presentInterpolatedFlock(this.previousFlock(), this.flock(), this.interpolationAlpha()) : []; }
  birdRotation(heading: { x: number; z: number }, bank: number): [number, number, number] {
    return [Math.PI / 2, Math.atan2(heading.x, heading.z), bank];
  }
  vehiclePosition() { const z = this.vehicleZ(); return { x: z * 0.35, y: 1, z }; }
  advanceVehicle() { this.vehicleZ.update((z) => z + 6); this.fleeing.set(true); }
  toggleFlee() { this.fleeing.update((value) => !value); }
  togglePause() { this.paused.update((value) => !value); }
  reset() {
    this.clock.reset();
    const initial = materializeFlock(FLOCK_DEFINITION, { position: { x: 0, y: 0, z: 0 }, radius: 1 });
    this.flock.set(initial); this.previousFlock.set(initial); this.interpolationAlpha.set(0);
    this.simulationTime.set(0); this.skippedSeconds.set(0); this.vehicleZ.set(-10); this.observerX.set(0);
    this.residency.set(updateFlockResidency(FLOCK_DEFINITION, { position: { x: 0, y: 0, z: 0 }, radius: 1 }));
  }
  setTimeScale(event: Event) { this.timeScale.set(Number((event.target as HTMLInputElement).value)); }
  setObserver(event: Event) { this.observerX.set(Number((event.target as HTMLInputElement).value)); }
}
