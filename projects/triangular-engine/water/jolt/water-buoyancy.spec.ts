import { Vector3 } from 'three';
import {
  DEFAULT_WATER_BUOYANCY_SETTINGS,
  resolveWaterBuoyancyImpulseInput,
} from './water-buoyancy';

describe('resolveWaterBuoyancyImpulseInput', () => {
  let sample: {
    position: Vector3;
    normal: Vector3;
    flow: Vector3;
  };

  beforeEach(() => {
    sample = {
      position: new Vector3(1, 2, 3),
      normal: new Vector3(0, 1, 0),
      flow: new Vector3(0.5, 0, -0.5),
    };
  });

  it('maps the water sample position/normal/flow into plain tuples', () => {
    const result = resolveWaterBuoyancyImpulseInput(sample, [0, -9.81, 0], 1 / 240);

    expect(result.surfacePosition).toEqual([1, 2, 3]);
    expect(result.surfaceNormal).toEqual([0, 1, 0]);
    expect(result.fluidVelocity).toEqual([0.5, 0, -0.5]);
    expect(result.gravity).toEqual([0, -9.81, 0]);
    expect(result.deltaTime).toBe(1 / 240);
  });

  it('defaults to the JoltPhysics.js buoyancy example settings', () => {
    const result = resolveWaterBuoyancyImpulseInput(sample, [0, -9.81, 0], 1 / 240);

    expect(result.buoyancy).toBe(DEFAULT_WATER_BUOYANCY_SETTINGS.buoyancy);
    expect(result.linearDrag).toBe(DEFAULT_WATER_BUOYANCY_SETTINGS.linearDrag);
    expect(result.angularDrag).toBe(DEFAULT_WATER_BUOYANCY_SETTINGS.angularDrag);
  });

  it('honours explicit settings overrides', () => {
    const result = resolveWaterBuoyancyImpulseInput(sample, [0, -9.81, 0], 1 / 240, {
      buoyancy: 0.6,
      linearDrag: 1,
      angularDrag: 0.2,
    });

    expect(result.buoyancy).toBe(0.6);
    expect(result.linearDrag).toBe(1);
    expect(result.angularDrag).toBe(0.2);
  });

  it('reads the sample fresh each call rather than caching a reference', () => {
    const first = resolveWaterBuoyancyImpulseInput(sample, [0, -9.81, 0], 1 / 240);
    sample.position.set(9, 9, 9);
    const second = resolveWaterBuoyancyImpulseInput(sample, [0, -9.81, 0], 1 / 240);

    expect(first.surfacePosition).toEqual([1, 2, 3]);
    expect(second.surfacePosition).toEqual([9, 9, 9]);
  });
});
