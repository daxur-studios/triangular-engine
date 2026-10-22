import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { EngineModule, EngineService } from 'triangular-engine';
import { JoltPhysicsModule } from '../jolt-physics.module';
import { JoltPhysicsService } from './jolt-physics.service';

@Component({
  imports: [EngineModule, JoltPhysicsModule],
  providers: EngineService.provide(),
  template: `<scene
    ><joltPhysics
      ><joltRigidBody [motionType]="2"
        ><joltBoxShape [params]="[1, 1, 1]" /></joltRigidBody></joltPhysics
  ></scene>`,
})
class TeardownFixture {}

describe('Jolt active-body teardown', () => {
  beforeAll(async () => {
    await JoltPhysicsService.load();
  });
  it('keeps listener wrappers alive through RemoveBody and can create another world afterwards', async () => {
    for (let i = 0; i < 2; i++) {
      const fixture = TestBed.createComponent(TeardownFixture);
      fixture.autoDetectChanges();
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
      fixture.destroy();
      expect(fixture.componentRef.hostView.destroyed).toBeTrue();
    }
  }, 15000);
});
