import { ICelestialBody } from '../bodies/celestial-body';
import { quatApplyToVec3 } from '../math/quat';
import { launchSitePose, ILaunchSite } from './launch-site';

const BODY: ICelestialBody = {
  id: 'test-planet',
  kind: 'planet',
  radiusM: 1000,
  muM3PerS2: 1,
};

function site(overrides: Partial<ILaunchSite>): ILaunchSite {
  return {
    id: 's',
    bodyId: 'test-planet',
    latitude: 0,
    longitude: 0,
    altitude: 0,
    orientation: 0,
    type: 'pad',
    ...overrides,
  };
}

describe('launchSitePose', () => {
  it('places a pole site straight up with identity rotation', () => {
    const { positionM, rotation } = launchSitePose(
      site({ latitude: 90 }),
      BODY,
    );

    expect(positionM[0]).toBeCloseTo(0, 6);
    expect(positionM[1]).toBeCloseTo(1000, 6);
    expect(positionM[2]).toBeCloseTo(0, 6);
    expect(rotation[0]).toBeCloseTo(0, 6);
    expect(rotation[1]).toBeCloseTo(0, 6);
    expect(rotation[2]).toBeCloseTo(0, 6);
    expect(rotation[3]).toBeCloseTo(1, 6);
  });

  it('adds altitude along the surface normal', () => {
    const { positionM } = launchSitePose(
      site({ latitude: 90, altitude: 250 }),
      BODY,
    );
    expect(positionM[1]).toBeCloseTo(1250, 6);
  });

  it('places a site relative to sampled terrain rather than the datum sphere', () => {
    const terrainBody: ICelestialBody = {
      ...BODY,
      terrain: {
        seed: 1,
        minElevationM: -100,
        maxElevationM: 100,
        generators: [],
        localFlatten: [
          {
            kind: 'circle',
            directionBodyFixed: [1, 0, 0],
            radiusM: 20,
            blendRadiusM: 20,
            elevationM: 80,
          },
        ],
      },
    };
    const { positionM } = launchSitePose(site({ altitude: 5 }), terrainBody);
    expect(positionM).toEqual([1085, 0, 0]);
  });

  it('places an equatorial site on the XZ plane, local +Y pointing outward', () => {
    const { positionM, rotation } = launchSitePose(site({}), BODY);

    expect(positionM[0]).toBeCloseTo(1000, 6);
    expect(positionM[1]).toBeCloseTo(0, 6);
    expect(positionM[2]).toBeCloseTo(0, 6);

    const localUp = quatApplyToVec3(rotation, [0, 1, 0]);
    expect(localUp[0]).toBeCloseTo(1, 6);
    expect(localUp[1]).toBeCloseTo(0, 6);
    expect(localUp[2]).toBeCloseTo(0, 6);
  });

  it('longitude rotates the equatorial position around the polar axis', () => {
    const { positionM } = launchSitePose(site({ longitude: 90 }), BODY);

    expect(positionM[0]).toBeCloseTo(0, 6);
    expect(positionM[2]).toBeCloseTo(1000, 6);
  });

  it('orientation yaws about the surface normal without tilting it', () => {
    const base = launchSitePose(site({}), BODY);
    const yawed = launchSitePose(site({ orientation: 90 }), BODY);

    const baseUp = quatApplyToVec3(base.rotation, [0, 1, 0]);
    const yawedUp = quatApplyToVec3(yawed.rotation, [0, 1, 0]);
    expect(yawedUp[0]).toBeCloseTo(baseUp[0], 6);
    expect(yawedUp[1]).toBeCloseTo(baseUp[1], 6);
    expect(yawedUp[2]).toBeCloseTo(baseUp[2], 6);

    const baseForward = quatApplyToVec3(base.rotation, [0, 0, 1]);
    const yawedForward = quatApplyToVec3(yawed.rotation, [0, 0, 1]);
    const differs =
      Math.abs(baseForward[0] - yawedForward[0]) > 1e-6 ||
      Math.abs(baseForward[1] - yawedForward[1]) > 1e-6 ||
      Math.abs(baseForward[2] - yawedForward[2]) > 1e-6;
    expect(differs).toBeTrue();
  });

  it('keeps local up radial at an arbitrary latitude and longitude', () => {
    const { positionM, rotation } = launchSitePose(
      site({ latitude: 37, longitude: -122, orientation: 73 }),
      BODY,
    );
    const radiusM = Math.hypot(...positionM);
    const radialUp = positionM.map((value) => value / radiusM);
    const localUp = quatApplyToVec3(rotation, [0, 1, 0]);

    expect(localUp[0]).toBeCloseTo(radialUp[0]!, 6);
    expect(localUp[1]).toBeCloseTo(radialUp[1]!, 6);
    expect(localUp[2]).toBeCloseTo(radialUp[2]!, 6);
  });
});
