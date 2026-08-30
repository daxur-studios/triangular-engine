import {
  buildCityBuildingsInstancedMesh,
  generateGridCityBuildings,
  generateVoronoiCityBuildings,
} from './city-block-generator';

describe('CityBlockGenerator', () => {
  it('generates grid buildings with zoned districts and height variation', () => {
    const groundElevation = (x: number, z: number) => 5;
    const buildings = generateGridCityBuildings(groundElevation, {
      blockCountX: 4,
      blockCountZ: 4,
      blockSizeM: 30,
      streetWidthM: 10,
      maxFloorsHeightM: 80,
      seed: 42,
    });

    expect(buildings.length).toBeGreaterThan(10);
    // Center buildings should be downtown / higher
    const downtown = buildings.filter((b) => b.districtType === 'downtown');
    const residential = buildings.filter((b) => b.districtType === 'residential');

    expect(downtown.length).toBeGreaterThan(0);
    expect(residential.length).toBeGreaterThan(0);

    const avgDowntownHeight =
      downtown.reduce((sum, b) => sum + b.dimensions[1], 0) / downtown.length;
    const avgResHeight =
      residential.reduce((sum, b) => sum + b.dimensions[1], 0) / residential.length;

    expect(avgDowntownHeight).toBeGreaterThan(avgResHeight);
  });

  it('generates radial / voronoi city buildings', () => {
    const groundElevation = (x: number, z: number) => 0;
    const buildings = generateVoronoiCityBuildings(groundElevation, {
      cityRadiusM: 80,
      maxFloorsHeightM: 60,
      seed: 99,
    });

    expect(buildings.length).toBeGreaterThan(15);
    expect(buildings.every((b) => b.dimensions[0] > 0 && b.dimensions[1] > 0)).toBeTrue();
  });

  it('creates Three.js InstancedMesh for efficient 1-draw-call rendering', () => {
    const groundElevation = () => 0;
    const buildings = generateGridCityBuildings(groundElevation, {
      blockCountX: 3,
      blockCountZ: 3,
    });

    const instancedMesh = buildCityBuildingsInstancedMesh(buildings);
    expect(instancedMesh.count).toBe(buildings.length);
    expect(instancedMesh.instanceMatrix).toBeDefined();
    expect(instancedMesh.instanceColor).toBeDefined();
  });
});
