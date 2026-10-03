import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';
import { Camera, PerspectiveCamera, Scene } from 'three';
import { EngineService } from '../../services/engine.service';
import { MaterialService } from '../../services/material.service';
import { ParticleEmitterComponent } from './particle-emitter.component';
import { ParticlePool } from './particle-pool';
import { PARTICLE_PRESETS } from './particle-presets';

@Component({
  standalone: true,
  imports: [ParticleEmitterComponent],
  template: `
    <particleEmitter
      [preset]="currentPreset()"
      [rate]="rate()"
      [maxParticles]="100"
      [speed]="[2, 4]"
      [gravity]="[0, -5, 0]"
      [loop]="isLooping()"
      (finished)="onFinished()"
      (activeCountChange)="onActiveCountChange($event)"
    />
  `,
})
class TestParticleHostComponent {
  currentPreset = signal<'fire' | 'smoke' | 'sparks' | 'explosion'>('fire');
  rate = signal(50);
  isLooping = signal(true);
  finishedCount = 0;
  lastActiveCount = 0;

  onFinished(): void {
    this.finishedCount++;
  }

  onActiveCountChange(count: number): void {
    this.lastActiveCount = count;
  }
}

describe('Particle System', () => {
  describe('ParticlePool', () => {
    let pool: ParticlePool;

    beforeEach(() => {
      pool = new ParticlePool(20);
    });

    it('allocates typed arrays correctly for max particle count', () => {
      expect(pool.aOffset.length).toBe(60); // 20 * 3
      expect(pool.aScale.length).toBe(20);
      expect(pool.aColor.length).toBe(80); // 20 * 4
      expect(pool.aRotation.length).toBe(20);
      expect(pool.activeCount).toBe(0);
    });

    it('spawns particles up to max count and clamps excess', () => {
      const config = PARTICLE_PRESETS.fire;
      for (let i = 0; i < 25; i++) {
        pool.spawn(config);
      }
      expect(pool.activeCount).toBe(20); // capped at max
    });

    it('updates particle physics with gravity and damping', () => {
      pool.setColorRamp(['#ffff00', '#ff0000']);
      const spawned = pool.spawn({
        ...PARTICLE_PRESETS.fire,
        shape: 'point',
        shapeSize: 0,
        direction: [0, 1, 0],
        speed: 10,
        spread: 0,
        gravity: [0, -9.8, 0],
        damping: 1.0,
      });
      expect(spawned).toBeTrue();
      expect(pool.activeCount).toBe(1);

      // Advance by 0.1s
      pool.update(0.1, {
        gravity: [0, -9.8, 0],
        damping: 1.0,
      });

      // Velocity Y: 10 + (-9.8 * 0.1) = 9.02
      // Position Y: 9.02 * 0.1 = 0.902
      expect(pool.aOffset[1]).toBeCloseTo(0.902, 2);
    });

    it('recycles expired particles using compact swap', () => {
      pool.spawn({
        ...PARTICLE_PRESETS.sparks,
        lifetime: 0.1, // expires fast
      });
      pool.spawn({
        ...PARTICLE_PRESETS.sparks,
        lifetime: 5.0, // stays alive
      });
      expect(pool.activeCount).toBe(2);

      // Advance by 0.2s - first particle dies, second particle stays
      pool.update(0.2, PARTICLE_PRESETS.sparks);
      expect(pool.activeCount).toBe(1);
    });

    it('interpolates color gradient across multi-stop ramps', () => {
      pool.setColorRamp(['#000000', '#ffffff']);
      pool.spawn({
        lifetime: 1.0,
        opacity: [1.0, 1.0],
      });

      // At half life (t = 0.5), color should be mid-gray (0.5, 0.5, 0.5)
      pool.update(0.5, {});
      expect(pool.aColor[0]).toBeCloseTo(0.5, 1);
      expect(pool.aColor[1]).toBeCloseTo(0.5, 1);
      expect(pool.aColor[2]).toBeCloseTo(0.5, 1);
      expect(pool.aColor[3]).toBeCloseTo(1.0, 2);
    });
  });

  describe('ParticleEmitterComponent', () => {
    let fixture: ComponentFixture<TestParticleHostComponent>;
    let host: TestParticleHostComponent;
    let tick$: BehaviorSubject<number>;
    let mockEngine: any;

    beforeEach(() => {
      tick$ = new BehaviorSubject<number>(0);
      const testCam = new PerspectiveCamera();
      mockEngine = {
        scene: new Scene(),
        camera$: new BehaviorSubject<Camera>(testCam),
        camera: testCam,
        tick$,
      };

      TestBed.configureTestingModule({
        imports: [TestParticleHostComponent],
        providers: [
          MaterialService,
          { provide: EngineService, useValue: mockEngine },
        ],
      });

      fixture = TestBed.createComponent(TestParticleHostComponent);
      host = fixture.componentInstance;
      fixture.detectChanges();
    });

    it('initializes and inherits configuration from preset', () => {
      const emitterEl = fixture.debugElement.children[0];
      const emitter = emitterEl.componentInstance as ParticleEmitterComponent;

      expect(emitter).toBeDefined();
      expect(emitter.preset()).toBe('fire');
      expect(emitter.resolvedConfig().rate).toBe(50); // host override
      expect(emitter.resolvedConfig().gravity).toEqual([0, -5, 0]); // host override
    });

    it('emits particles on engine tick loop', () => {
      // Simulate 5 frames of 0.05s (0.25s total at rate 50 = ~12 particles)
      for (let i = 0; i < 5; i++) {
        tick$.next(0.05);
      }
      fixture.detectChanges();

      expect(host.lastActiveCount).toBeGreaterThan(5);
    });

    it('supports play, pause, and stop lifecycle', () => {
      const emitter = fixture.debugElement.children[0].componentInstance as ParticleEmitterComponent;

      tick$.next(0.1);
      expect(host.lastActiveCount).toBeGreaterThan(0);

      // Pause stops new emissions but preserves alive particles
      emitter.pause();
      expect(emitter.isPlaying()).toBeFalse();

      // Stop clears all active particles and resets state
      emitter.stop();
      expect(emitter.isPlaying()).toBeFalse();
      expect(fixture.debugElement.children[0].componentInstance.object3D().geometry.instanceCount).toBe(0);
    });

    it('emits finished event on non-looping burst completion', () => {
      host.isLooping.set(false);
      fixture.detectChanges();

      const emitter = fixture.debugElement.children[0].componentInstance as ParticleEmitterComponent;
      emitter.emitBurst(10);
      expect(host.lastActiveCount).toBe(10);

      // Advance time past max lifetime (fire lifetime is ~1.4s)
      tick$.next(2.5);
      fixture.detectChanges();

      expect(host.finishedCount).toBeGreaterThanOrEqual(1);
    });
  });
});
