import {
  buildOldTownBuildingGeometry,
  computeVoronoiCells,
  generateVoronoiCity,
  insetPolygon,
} from './voronoi-city-generator';
import { ICityCrossSection } from '../core/city-transit-types';

describe('VoronoiCityGenerator', () => {
  it('computes 2D Voronoi polygonal cells from seeds', () => {
    const seeds: [number, number][] = [
      [0, 0],
      [20, 0],
      [-20, 0],
      [0, 20],
      [0, -20],
    ];
    const cells = computeVoronoiCells(seeds, 50);
    expect(cells.length).toBe(5);
    expect(cells[0].polygon.length).toBeGreaterThanOrEqual(3);
  });

  it('insets a convex polygon without crashing', () => {
    const poly: [number, number][] = [
      [-10, -10],
      [10, -10],
      [10, 10],
      [-10, 10],
    ];
    const inset = insetPolygon(poly, 2.0, [0, 0]);
    expect(inset.length).toBe(4);
    expect(inset[0][0]).toBeGreaterThan(-10);
  });

  it('builds a 2-3 story European old-town building geometry with pitched roof', () => {
    const quad: [number, number][] = [
      [-5, 0],
      [5, 0],
      [4, 8],
      [-4, 8],
    ];
    const geom = buildOldTownBuildingGeometry(quad, 0, 3, false, 0xd97c55, 0xa63a22);
    expect(geom.getAttribute('position')).toBeDefined();
    expect(geom.getAttribute('normal')).toBeDefined();
    expect(geom.getAttribute('color')).toBeDefined();
  });

  it('generates an organic Voronoi old-town city with clean roads and 2-3 story buildings', () => {
    const crossSection: ICityCrossSection = {
      roadwayWidthM: 8.0,
      sidewalkWidthM: 1.5,
      curbHeightM: 0.15,
      greenVergeWidthM: 0.0,
      medianWidthM: 0.0,
    };

    const result = generateVoronoiCity(() => 0, crossSection, {
      radiusM: 80,
      seedCount: 16,
      lloydIterations: 2,
      seed: 42,
    });

    expect(result.cells.length).toBeGreaterThanOrEqual(10);
    expect(result.buildingCount).toBeGreaterThan(10);
    expect(result.buildingsMeshGeometry).toBeDefined();
    expect(result.roadMeshGeometry).toBeDefined();
    expect(result.graph.nodes.length).toBeGreaterThan(10);
    expect(result.graph.edges.length).toBeGreaterThan(10);
  });
});
