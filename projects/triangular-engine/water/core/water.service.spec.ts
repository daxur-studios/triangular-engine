import { Vector3 } from 'three';
import { PlaneWaterDomain, SphereWaterDomain } from './water-domain';
import type { WaterSurface } from './water-surface';
import { WaterService, sampleWaterBody } from './water.service';

const flatSurface: WaterSurface = {
  getHeight: () => 0,
  getNormal: (_x, _z, _t, out = new Vector3()) => out.set(0, 1, 0),
  getFlow: (_x, _z, _t, out = new Vector3()) => out.set(2, 0, 0),
};

describe('WaterService', () => {
  it('samples plane and spherical domains in world space', () => {
    const plane = sampleWaterBody(
      {
        id: 'plane',
        domain: new PlaneWaterDomain({ seaLevelY: 5 }),
        surface: flatSurface,
      },
      new Vector3(3, 2, 4),
      0,
    );
    expect(plane.signedDistance).toBeCloseTo(-3);
    expect(plane.depth).toBeCloseTo(3);
    expect(plane.position.toArray()).toEqual([3, 5, 4]);
    expect(plane.flow.toArray()).toEqual([2, 0, 0]);

    const sphere = sampleWaterBody(
      {
        id: 'sphere',
        domain: new SphereWaterDomain(10),
        surface: flatSurface,
      },
      new Vector3(0, 12, 0),
      0,
    );
    expect(sphere.signedDistance).toBeCloseTo(2);
    expect(sphere.normal.toArray()).toEqual([0, 1, 0]);
  });

  it('selects the highest-priority containing body', () => {
    const service = new WaterService();
    service.register({
      id: 'ocean',
      priority: 0,
      domain: new PlaneWaterDomain(),
      surface: flatSurface,
    });
    service.register({
      id: 'river',
      priority: 10,
      domain: new PlaneWaterDomain({ seaLevelY: 2 }),
      surface: flatSurface,
      contains: (position) => Math.abs(position.x) < 5,
    });

    expect(service.sample(new Vector3(0, 3, 0), 0)?.body.id).toBe('river');
    expect(service.sample(new Vector3(10, 3, 0), 0)?.body.id).toBe('ocean');
  });

  it('fires one crossing event per hysteresis-qualified transition', () => {
    const service = new WaterService();
    service.register({
      id: 'ocean',
      domain: new PlaneWaterDomain(),
      surface: flatSurface,
    });
    const position = new Vector3(0, 1, 0);
    const tracker = service.track(() => position, { hysteresis: 0.2 });
    const events: string[] = [];
    tracker.crossings$.subscribe((event) => events.push(event.type));

    service.updateTracked(0);
    position.y = -0.1;
    service.updateTracked(1);
    position.y = -0.3;
    service.updateTracked(2);
    position.y = 0.1;
    service.updateTracked(3);
    position.y = 0.3;
    service.updateTracked(4);

    expect(events).toEqual(['enter', 'exit']);
    expect(tracker.state$.value.underwater).toBeFalse();
  });
});
