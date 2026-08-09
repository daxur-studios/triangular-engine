import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { EngineModule } from 'triangular-engine';
import { FixedStepClock, materializeFlock, presentFlock, stepFlock, type FlockState } from 'triangular-engine/animals';

const terrain = { sample: (position: { x: number; y: number; z: number }) => ({ height: Math.sin(position.x * 0.08) * 0.4 + Math.cos(position.z * 0.06) * 0.3, normal: { x: 0, y: 1, z: 0 } }) };
const OBSERVER_POSITION = { x: 0, y: 0, z: 0 };
const RESIDENCY_RADIUS = 50;

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
  readonly fleeing = signal(false);
  readonly timeScale = signal(1);
  readonly simulationTime = signal(0);
  readonly flock = signal<FlockState[]>(materializeFlock({ id: 'demo-birds', seed: 42, origin: { x: 0, y: 8, z: 0 }, count: 8, spacing: 7, speed: 4, cullDistance: 80, hysteresis: 12 }, { position: { x: 0, y: 0, z: 0 }, radius: 1 }));

  constructor() {
    const timer = window.setInterval(() => {
      const result = this.clock.advance(1 / 30, this.timeScale());
      let next = this.flock();
      for (let i = 0; i < result.steps; i += 1) next = stepFlock(next, this.clock.stepSeconds, 4, terrain, this.fleeing() ? { id: 'vehicle', position: { x: 0, y: 0, z: 0 }, radius: 18, strength: 8 } : undefined);
      next = next.filter((animal) => {
        const dx = animal.position.x - OBSERVER_POSITION.x;
        const dy = animal.position.y - OBSERVER_POSITION.y;
        const dz = animal.position.z - OBSERVER_POSITION.z;
        return dx * dx + dy * dy + dz * dz <= RESIDENCY_RADIUS * RESIDENCY_RADIUS;
      });
      this.flock.set(next);
      this.simulationTime.set(result.time);
    }, 33);
    this.destroyRef.onDestroy(() => window.clearInterval(timer));
  }

  presentation() { return presentFlock(this.flock()); }
  toggleFlee() { this.fleeing.update((value) => !value); }
  setTimeScale(event: Event) { this.timeScale.set(Number((event.target as HTMLInputElement).value)); }
}
