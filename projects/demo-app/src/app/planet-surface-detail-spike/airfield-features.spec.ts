import { FlatFeatureSet, flatFeatureOffset, type IFlatSegmentFeature } from 'triangular-engine/worldgen/render/core';
import { AIRFIELD_PRIORITY, airfieldFeatures } from './airfield-features';
import { runwayFrame, type IRunwaySite, type Vec3 } from './runway-site';

const RADIUS_M = 600_000;
const centre: Vec3 = [0.3, 0.2, Math.sqrt(1 - 0.13)];
const { along, across } = runwayFrame(centre, 0.4);
const site: IRunwaySite = { centre, along, across, heightM: 120 };
const at = (a: number, b: number) => flatFeatureOffset(centre, { along, across }, a, b, RADIUS_M);

describe('airfield flat features (spike)', () => {
  const hill = (d: Vec3) => 120 + 40_000 * (d[0] - centre[0]);
  const features = airfieldFeatures(site, RADIUS_M, hill);
  const set = new FlatFeatureSet(features, RADIUS_M);

  it('lays the runway along the site frame', () => {
    const runway = set.features.find((f) => f.source.id === 'runway')!;
    expect(runway.along.every((v, i) => Math.abs(v - along[i]) < 1e-9)).toBeTrue();
    expect(runway.priority).toBe(AIRFIELD_PRIORITY.runway);
  });

  it('flattens the airfield to the site height and lets the roads follow the ground', () => {
    expect(set.stampElevation(at(500, 0), 999)).toBeCloseTo(120, 6);
    expect(set.stampElevation(at(0, 290), 999)).toBeCloseTo(120, 6);
    const far = at(3500, 2800); // an interior joint of the access road
    const roadHeight = set.stampElevation(far, 0);
    expect(Math.abs(roadHeight - hill(far))).toBeLessThan(5);
  });

  it('paints roads over water without flattening them', () => {
    const wet = airfieldFeatures(site, RADIUS_M, (d) => (d[0] - centre[0] > 0.001 ? null : 120));
    const roads = wet.filter((f): f is IFlatSegmentFeature => f.kind === 'segment' && f.markings === 'road');
    expect(roads.some((f) => f.heightM === undefined)).toBeTrue();
    expect(roads.some((f) => f.heightM !== undefined)).toBeTrue();
  });

  it('keeps trees off the roads through the clearance query', () => {
    expect(set.isInClearance(at(1200, 3000))).toBeTrue(); // main road centreline
    expect(set.isInClearance(at(1200 + 4 + 13, 3000))).toBeFalse();
  });
});
