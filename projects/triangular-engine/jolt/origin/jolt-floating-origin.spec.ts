import { Component, viewChild } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { Vector3Tuple } from 'three';
import { EngineModule, EngineService } from 'triangular-engine';
import { JoltPhysicsModule } from '../jolt-physics.module';
import { Jolt, JoltPhysicsService } from '../jolt-physics/jolt-physics.service';
import { JoltRigidBodyComponent } from '../jolt-rigid-body/jolt-rigid-body.component';
import { float32UlpAt } from './float32-ulp';
import { JoltFloatingOrigin } from './jolt-floating-origin';

const FAR_X = 1e5 + 0.0625;
const PLANET_SCALE_X = 1e7 + 0.125;
const NON_MOVING_LAYER = 0;

@Component({
  imports: [EngineModule, JoltPhysicsModule],
  providers: EngineService.provide(),
  template: `<scene><joltPhysics [paused]="true"><joltRigidBody [motionType]="2" [position]="position"><joltBoxShape [params]="[1, 1, 1]" /></joltRigidBody></joltPhysics></scene>`,
})
class OriginFixture {
  position: Vector3Tuple = [0, 0, 0];
  readonly rigidBody = viewChild.required(JoltRigidBodyComponent);
}

async function until(check: () => boolean): Promise<void> {
  const deadline = performance.now() + 10000;
  while (!check()) {
    if (performance.now() > deadline) throw new Error('Jolt origin fixture did not become ready.');
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
  }
}

function readPosition(body: Jolt.Body): Vector3Tuple {
  const p = body.GetPosition();
  return [p.GetX(), p.GetY(), p.GetZ()];
}

async function createFixture(position: Vector3Tuple) {
  const fixture = TestBed.createComponent(OriginFixture);
  fixture.componentInstance.position = position;
  fixture.autoDetectChanges();
  await until(() => !!fixture.componentInstance.rigidBody().body());
  const service = fixture.componentInstance.rigidBody().physicsService;
  const body = fixture.componentInstance.rigidBody().body()!;
  await until(() => service.bodies$.value.includes(body));
  return { fixture, service, body };
}

function createStaticBody(service: JoltPhysicsService, x: number): Jolt.Body {
  const bodyInterface = service.metaData$.value!.bodyInterface;
  const shape = new Jolt.BoxShape(new Jolt.Vec3(0.5, 0.5, 0.5), 0.05);
  const position = new Jolt.RVec3(x, 0, 0);
  const settings = new Jolt.BodyCreationSettings(
    shape,
    position,
    new Jolt.Quat(0, 0, 0, 1),
    Jolt.EMotionType_Static,
    NON_MOVING_LAYER,
  );
  const body = bodyInterface.CreateBody(settings);
  Jolt.destroy(settings);
  Jolt.destroy(position);
  return body;
}

describe('JoltFloatingOrigin', () => {
  beforeAll(async () => {
    await JoltPhysicsService.load();
  });

  it('keeps a far body at its fractional offset after rebasing', async () => {
    const { fixture, service, body } = await createFixture([FAR_X, 0, 0]);
    try {
      const before = readPosition(body)[0];
      expect(Math.abs(before - FAR_X)).toBeLessThanOrEqual(float32UlpAt(1e5));

      const origin = new JoltFloatingOrigin(service);
      origin.rebaseTo([1e5, 0, 0]);
      const after = readPosition(body)[0];
      expect(Math.abs(after - 0.0625)).toBeLessThanOrEqual(2 * float32UlpAt(0.0625));
    } finally {
      fixture.destroy();
    }
  }, 15000);

  it('shows float32 loss at 1e7 and keeps a body placed in the local frame exact', async () => {
    const far = await createFixture([PLANET_SCALE_X, 0, 0]);
    try {
      const read = readPosition(far.body)[0];
      expect(read).not.toBe(PLANET_SCALE_X);
      expect(Math.abs(read - PLANET_SCALE_X)).toBeLessThanOrEqual(float32UlpAt(1e7));
    } finally {
      far.fixture.destroy();
    }

    const origin = await createFixture([0, 0, 0]);
    try {
      new JoltFloatingOrigin(origin.service).rebaseTo([1e7, 0, 0]);
    } finally {
      origin.fixture.destroy();
    }
    const local = await createFixture([0.125, 0, 0]);
    try {
      expect(readPosition(local.body)[0]).toBe(0.125);
    } finally {
      local.fixture.destroy();
    }
  }, 30000);

  it('leaves bodies alone below the threshold and shifts them by the delta above it', async () => {
    const { fixture, service, body } = await createFixture([200, 0, 0]);
    try {
      const origin = new JoltFloatingOrigin(service, { thresholdM: 100 });

      expect(origin.update([50, 0, 0])).toBeUndefined();
      expect(readPosition(body)).toEqual([200, 0, 0]);

      const event = origin.update([150, 0, 0]);
      expect(event).toBeDefined();
      expect(event!.delta.x).toBe(150);
      expect(readPosition(body)[0]).toBe(50);
    } finally {
      fixture.destroy();
    }
  }, 15000);

  it('shifts tracked bodies outside bodies$ until they are untracked', async () => {
    const { fixture, service } = await createFixture([0, 0, 0]);
    const bodyInterface = service.metaData$.value!.bodyInterface;
    const extra = createStaticBody(service, 300);
    try {
      const origin = new JoltFloatingOrigin(service, { thresholdM: 100 });
      origin.track(extra);
      origin.rebaseTo([100, 0, 0]);
      expect(readPosition(extra)[0]).toBe(200);

      origin.untrack(extra);
      origin.rebaseTo([150, 0, 0]);
      expect(readPosition(extra)[0]).toBe(200);
    } finally {
      bodyInterface.DestroyBody(extra.GetID());
      fixture.destroy();
    }
  }, 15000);

  it('stops shifting tracked bodies after dispose while bodies$ still shift', async () => {
    const { fixture, service, body } = await createFixture([0, 0, 0]);
    const bodyInterface = service.metaData$.value!.bodyInterface;
    const extra = createStaticBody(service, 300);
    try {
      const origin = new JoltFloatingOrigin(service);
      origin.track(extra);
      origin.dispose();
      origin.rebaseTo([100, 0, 0]);
      expect(readPosition(extra)[0]).toBe(300);
      expect(readPosition(body)[0]).toBe(-100);
    } finally {
      bodyInterface.DestroyBody(extra.GetID());
      fixture.destroy();
    }
  }, 15000);

  it('throws and leaves the origin unchanged when Jolt is not initialised', () => {
    const service = new JoltPhysicsService();
    const origin = new JoltFloatingOrigin(service, { thresholdM: 100 });
    expect(() => origin.update([1e5, 0, 0])).toThrowError(/Jolt is not initialised/);
    expect(() => origin.rebaseTo([1e5, 0, 0])).toThrowError(/Jolt is not initialised/);
    expect(origin.origin.origin.toArray()).toEqual([0, 0, 0]);
  });

  it('fires onRebase listeners once per rebase', async () => {
    const { fixture, service } = await createFixture([0, 0, 0]);
    try {
      const origin = new JoltFloatingOrigin(service);
      let calls = 0;
      origin.origin.onRebase(() => calls++);
      origin.rebaseTo([10, 0, 0]);
      origin.rebaseTo([20, 0, 0]);
      expect(calls).toBe(2);
    } finally {
      fixture.destroy();
    }
  }, 15000);
});
