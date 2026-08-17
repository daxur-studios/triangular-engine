import type { IPartArchetype } from './parts-archetype';
import { buildPartMesh, buildPartMeshGroup, PARTS_MAX_TRIANGLES_PER_MESH } from './parts-mesh';
import type { IPartSolid } from './parts-solid';

describe('parts-mesh', () => {
  const solids: readonly IPartSolid[] = [
    {
      id: 'box-base',
      shape: 'box',
      positionM: [0, 0, 0],
      orientation: [0, 0, 0, 1],
      dimensionsM: [0.5, 0.5, 0.5],
      linkId: 0,
      materialHex: '#ff0000',
      collidable: true,
    },
    {
      id: 'arm-cylinder',
      shape: 'cylinder',
      positionM: [0, 1, 0],
      orientation: [0, 0, 0, 1],
      dimensionsM: [0.1, 1.0],
      linkId: 1,
      materialHex: '#00ff00',
      collidable: true,
    },
  ];

  it('builds a valid BufferGeometry with correct attributes and finite values', () => {
    const result = buildPartMesh(solids);
    const geom = result.geometry;

    expect(geom.getAttribute('position')).toBeDefined();
    expect(geom.getAttribute('normal')).toBeDefined();
    expect(geom.getAttribute('color')).toBeDefined();
    expect(geom.getAttribute('linkId')).toBeDefined();
    expect(geom.getIndex()).toBeDefined();

    expect(result.triangleCount).toBeGreaterThan(0);
    expect(result.vertexCount).toBeGreaterThan(0);

    const posAttr = geom.getAttribute('position');
    for (let i = 0; i < posAttr.count; i++) {
      expect(Number.isFinite(posAttr.getX(i))).toBeTrue();
      expect(Number.isFinite(posAttr.getY(i))).toBeTrue();
      expect(Number.isFinite(posAttr.getZ(i))).toBeTrue();
    }
  });

  it('tags vertices with correct linkId attributes', () => {
    const result = buildPartMesh(solids);
    const linkAttr = result.geometry.getAttribute('linkId');

    let hasLink0 = false;
    let hasLink1 = false;

    for (let i = 0; i < linkAttr.count; i++) {
      const val = linkAttr.getX(i);
      if (val === 0) hasLink0 = true;
      if (val === 1) hasLink1 = true;
    }

    expect(hasLink0).toBeTrue();
    expect(hasLink1).toBeTrue();
  });

  it('tags vertices with correct colors parsed from materialHex', () => {
    const result = buildPartMesh(solids);
    const colorAttr = result.geometry.getAttribute('color');

    // Solid 0 has #ff0000 (r=1, g=0, b=0)
    expect(colorAttr.getX(0)).toBeCloseTo(1, 2);
    expect(colorAttr.getY(0)).toBeCloseTo(0, 2);
    expect(colorAttr.getZ(0)).toBeCloseTo(0, 2);
  });

  it('buildPartMeshGroup builds a Group with separated link meshes', () => {
    const archetype: IPartArchetype = {
      schemaVersion: 1,
      id: 'leg-part',
      solids: [],
      sockets: [],
      joint: {
        anchorM: [0, 0.5, 0],
        axis: [1, 0, 0],
        rangeRad: [0, 1],
        restRad: 0,
      },
    };

    const group = buildPartMeshGroup(solids, archetype);
    expect(group.children.length).toBe(2);

    const link0 = group.getObjectByName('link-0');
    expect(link0).toBeDefined();

    const jointPivot = group.getObjectByName('joint-pivot');
    expect(jointPivot).toBeDefined();
    expect(jointPivot?.position.y).toBe(0.5);

    const link1 = jointPivot?.getObjectByName('link-1');
    expect(link1).toBeDefined();
  });
});
