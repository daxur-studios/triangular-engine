import { clothDropSpheres, createClothMesh, createSeededRandom, createSoftSphereMesh, meshRestShape } from './soft-body-example-meshes';

describe('official soft-body example meshes', () => {
  it('builds the 40 x 40 cloth from soft_body.html', () => {
    const cloth = createClothMesh(40, 0.5);
    expect(cloth.vertices.length).toBe(1600);
    expect(cloth.faces.length).toBe(3042);
    expect(cloth.cornerVertexIndices).toEqual([0, 39, 1560, 1599]);
    expect(cloth.vertices[0]).toEqual([-9.75, 0, -9.75]);
    expect(cloth.vertices[1599]).toEqual([9.75, 0, 9.75]);
  });

  it('builds the polar sphere from soft_sphere_pressure.html', () => {
    const sphere = createSoftSphereMesh(2, 10, 20);
    expect(sphere.vertices.length).toBe(162);
    expect(sphere.faces.length).toBe(320);
    for (const [x, y, z] of sphere.vertices) {
      expect(Math.hypot(x, y, z)).toBeCloseTo(2, 6);
    }
    const rest = meshRestShape(sphere.vertices, sphere.faces);
    const analytic = (4 / 3) * Math.PI * 2 ** 3;
    // A coarse polar mesh inscribes the sphere: 10 rings by 20 segments is about 95% of the volume.
    expect(rest.volume / analytic).toBeGreaterThan(0.95);
    expect(rest.volume / analytic).toBeLessThanOrEqual(1);
  });

  it('measures the cloth rest edges once', () => {
    const cloth = createClothMesh(40, 0.5);
    const rest = meshRestShape(cloth.vertices, cloth.faces);
    // 40 * 39 horizontal + 40 * 39 vertical + 39 * 39 cell diagonals.
    expect(rest.edges.length).toBe(40 * 39 + 40 * 39 + 39 * 39);
    for (const edge of rest.edges) expect(edge.length).toBeGreaterThan(0);
  });

  it('places the ten cloth spheres deterministically', () => {
    const first = clothDropSpheres(1337);
    const second = clothDropSpheres(1337);
    const other = clothDropSpheres(7);
    expect(first).toEqual(second);
    expect(first).not.toEqual(other);
    expect(first.length).toBe(10);
    expect(first[0].position[1]).toBeCloseTo(15, 6);
    expect(first[9].position[1]).toBeCloseTo(15 + 2 * 0.75 * 9, 6);
    for (const sphere of first) {
      expect(sphere.radius).toBe(0.75);
      expect(sphere.massKg).toBe(100);
      expect(sphere.position[0]).toBeGreaterThanOrEqual(0);
      expect(sphere.position[0]).toBeLessThanOrEqual(2);
    }
  });

  it('xorshift32 is repeatable', () => {
    const a = createSeededRandom(42);
    const b = createSeededRandom(42);
    for (let i = 0; i < 5; i++) expect(a()).toBe(b());
  });
});
