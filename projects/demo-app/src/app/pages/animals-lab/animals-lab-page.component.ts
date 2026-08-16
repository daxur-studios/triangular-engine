import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { EngineModule } from 'triangular-engine';
import { type AnimalGroupTimeline, sampleAnimalGroupTimeline } from 'triangular-engine/animals';

const TIMELINE: AnimalGroupTimeline = {
  key: { worldId: 'demo-world', planetId: 'planet-a', cellId: 'forest-17', speciesId: 'woodland-birds', groupId: 'flock-1', seed: 42 },
  destinations: [
    { id: 'forest-region', position: { x: -12, y: 8, z: -5 }, activity: 'rest', dwellDuration: 6 },
    { id: 'feeding-region', position: { x: 13, y: 11, z: 7 }, activity: 'feed', dwellDuration: 6 },
    { id: 'ridge-region', position: { x: 2, y: 15, z: -12 }, activity: 'rest', dwellDuration: 6 },
  ],
  travelSpeed: 6,
  travelArcHeight: 5,
  memberCount: 9,
};

@Component({
  selector: 'app-animals-lab-page', imports: [EngineModule],
  templateUrl: './animals-lab-page.component.html', styleUrl: './animals-lab-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush, host: { class: 'flex-page' },
})
export class AnimalsLabPageComponent {
  private readonly destroyRef = inject(DestroyRef);
  readonly universalTime = signal(0);
  readonly timeScale = signal(1);
  readonly paused = signal(false);
  readonly snapshot = computed(() => sampleAnimalGroupTimeline(TIMELINE, this.universalTime()));
  readonly reconstructionMatches = computed(() =>
    JSON.stringify(sampleAnimalGroupTimeline(TIMELINE, this.universalTime())) === JSON.stringify(this.snapshot()));

  constructor() {
    let previous = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now();
      const elapsed = Math.min(0.1, Math.max(0, (now - previous) / 1000));
      previous = now;
      if (!this.paused() && this.timeScale() !== 0) {
        this.universalTime.update((time) => time + elapsed * this.timeScale());
      }
    }, 33);
    this.destroyRef.onDestroy(() => window.clearInterval(timer));
  }

  setUniversalTime(event: Event): void {
    const time = Number((event.target as HTMLInputElement).value);
    if (Number.isFinite(time)) this.universalTime.set(time);
  }
  setTimeScale(scale: number): void {
    this.timeScale.set(scale);
    this.paused.set(false);
  }
  togglePause(): void { this.paused.update((paused) => !paused); }
  reset(): void {
    this.universalTime.set(0);
    this.timeScale.set(1);
    this.paused.set(false);
  }
}
