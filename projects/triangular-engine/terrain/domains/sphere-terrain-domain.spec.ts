import { ConstantTerrainField } from '../core/terrain-field';
import { generateTerrainPatchMesh } from '../meshing/terrain-patch-mesher';
import {
  SPHERE_TERRAIN_FACES,
  SphereTerrainDomain,
  sphereFaceUvToDirection,
} from './sphere-terrain-domain';

describe('SphereTerrainDomain', () => {
  it('maps all six face centres to their canonical outward axes', () => {
    expect(
      SPHERE_TERRAIN_FACES.map((face) => sphereFaceUvToDirection(face, 0, 0)),
    ).toEqual([
      [1, 0, -0],
      [-1, 0, 0],
      [0, 1, -0],
      [0, -1, 0],
      [0, 0, 1],
      [-0, 0, -1],
    ]);
  });

  it('produces outward normals and winding on every face', () => {
    const domain = new SphereTerrainDomain(1_000);
    for (const face of SPHERE_TERRAIN_FACES) {
      const mesh = generateTerrainPatchMesh(
        new ConstantTerrainField(),
        domain,
        { address: { face, level: 0, x: 0, y: 0 }, resolution: 8 },
      );
      for (let index = 0; index < mesh.surface.positions.length; index += 3) {
        const world = [
          mesh.centerWorldM[0] + mesh.surface.positions[index],
          mesh.centerWorldM[1] + mesh.surface.positions[index + 1],
          mesh.centerWorldM[2] + mesh.surface.positions[index + 2],
        ];
        const dot =
          world[0] * mesh.surface.normals[index] +
          world[1] * mesh.surface.normals[index + 1] +
          world[2] * mesh.surface.normals[index + 2];
        expect(dot).toBeGreaterThan(0);
      }
    }
  });

  it('matches positions and normals across cube-face boundaries', () => {
    const domain = new SphereTerrainDomain(2_000);
    const field = new ConstantTerrainField(10);
    const positiveX = generateTerrainPatchMesh(field, domain, {
      address: { face: 'positive-x', level: 0, x: 0, y: 0 },
      resolution: 8,
    });
    const negativeZ = generateTerrainPatchMesh(field, domain, {
      address: { face: 'negative-z', level: 0, x: 0, y: 0 },
      resolution: 8,
    });
    const row = 9;
    for (let v = 0; v < row; v++) {
      const first = (v * row + 8) * 3;
      const second = v * row * 3;
      for (let axis = 0; axis < 3; axis++) {
        const positionDelta = Math.abs(
          positiveX.centerWorldM[axis] +
            positiveX.surface.positions[first + axis] -
            (negativeZ.centerWorldM[axis] +
              negativeZ.surface.positions[second + axis]),
        );
        expect(positionDelta).toBeLessThan(0.0002);
        expect(positiveX.surface.normals[first + axis]).toBeCloseTo(
          negativeZ.surface.normals[second + axis],
          5,
        );
      }
    }
  });

  it('keeps deep-level vertices patch-local at billion-metre radius', () => {
    const domain = new SphereTerrainDomain(1_000_000_000);
    const mesh = generateTerrainPatchMesh(new ConstantTerrainField(), domain, {
      address: { face: 'positive-x', level: 20, x: 524_288, y: 524_288 },
      resolution: 8,
    });
    expect(Math.max(...mesh.surface.positions.map(Math.abs))).toBeLessThan(
      2_000,
    );
  });
});
