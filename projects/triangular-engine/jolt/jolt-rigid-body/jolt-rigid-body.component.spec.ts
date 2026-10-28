import { Component, signal, viewChild } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { EngineModule, EngineService } from 'triangular-engine';
import { JoltPhysicsModule } from '../jolt-physics.module';
import { Jolt, JoltPhysicsService } from '../jolt-physics/jolt-physics.service';
import { JoltRigidBodyComponent } from './jolt-rigid-body.component';

type Child = { id: string; position: [number, number, number] };
const SHAPE_SIZE: [number, number, number] = [1, 1, 1];
const LEFT: Child = { id: 'left', position: [0, 0, 0] };
const MIDDLE: Child = { id: 'middle', position: [0, 2, 0] };
const RIGHT: Child = { id: 'right', position: [0, 4, 0] };
const EXTRA: Child = { id: 'extra', position: [0, 6, 0] };

@Component({
  imports: [EngineModule, JoltPhysicsModule],
  providers: EngineService.provide(),
  template: `<scene><joltPhysics [paused]="true"><joltRigidBody [motionType]="2" [position]="[7, 11, 13]">
    @for (child of children(); track child.id) {
      <joltBoxShape [id]="child.id" [position]="child.position" [params]="size" />
    }
  </joltRigidBody></joltPhysics></scene>`,
})
class MutableCompoundFixture {
  readonly children = signal<readonly Child[]>([LEFT, MIDDLE, RIGHT]);
  readonly size = SHAPE_SIZE;
  readonly rigidBody = viewChild(JoltRigidBodyComponent);
}

async function until(check: () => boolean): Promise<void> {
  const deadline = performance.now() + 10000;
  while (!check()) {
    if (performance.now() > deadline) throw new Error('Jolt compound fixture did not become ready.');
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
  }
}

describe('mutable compound reconciliation', () => {
  beforeAll(async () => JoltPhysicsService.load());
  it('recomputes the mass centroid on removal-only and addition-only updates without moving the body origin', async () => {
    const fixture = TestBed.createComponent(MutableCompoundFixture);
    fixture.autoDetectChanges();
    try {
      await until(() => !!fixture.componentInstance.rigidBody()?.body());
      const body = fixture.componentInstance.rigidBody()!.body()!;
      const center = () => body.GetShape().GetCenterOfMass().GetY();
      const position = () => [body.GetPosition().GetX(), body.GetPosition().GetY(), body.GetPosition().GetZ()];
      const originalPosition = position();
      expect(center()).toBeCloseTo(2, 4);
      fixture.componentInstance.children.set([LEFT, MIDDLE]);
      fixture.detectChanges();
      await until(() => Jolt.castObject(body.GetShape(), Jolt.MutableCompoundShape).GetNumSubShapes() === 2);
      expect(center()).toBeCloseTo(1, 4);
      expect(position()).toEqual(originalPosition);
      fixture.componentInstance.children.set([LEFT, MIDDLE, EXTRA]);
      fixture.detectChanges();
      await until(() => Jolt.castObject(body.GetShape(), Jolt.MutableCompoundShape).GetNumSubShapes() === 3);
      expect(center()).toBeCloseTo(8 / 3, 4);
      expect(position()).toEqual(originalPosition);
      expect(fixture.componentInstance.rigidBody()!.body()).toBe(body);
    } finally {
      fixture.destroy();
    }
  }, 30000);
});

