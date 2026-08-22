import { DEMO_CHOPSTICK_TOWER_ARCHETYPE, DEMO_RUNWAY_ARCHETYPE } from './structures-catalog';
import { buildStructureMesh, buildStructureMeshGroup } from './structures-mesh';
import { generateStructureSkeleton } from './structures-skeleton';

describe('buildStructureMesh & buildStructureMeshGroup', () => {
  it('builds valid merged BufferGeometry with required attributes', () => {
    const solids = generateStructureSkeleton(DEMO_RUNWAY_ARCHETYPE, 77);
    const result = buildStructureMesh(solids, DEMO_RUNWAY_ARCHETYPE);

    expect(result.geometry).toBeDefined();
    expect(result.triangleCount).toBeGreaterThan(0);
    expect(result.vertexCount).toBeGreaterThan(0);

    const posAttr = result.geometry.getAttribute('position');
    const normAttr = result.geometry.getAttribute('normal');
    const linkAttr = result.geometry.getAttribute('linkId');
    const colorAttr = result.geometry.getAttribute('color');

    expect(posAttr).toBeDefined();
    expect(normAttr).toBeDefined();
    expect(linkAttr).toBeDefined();
    expect(colorAttr).toBeDefined();
  });

  it('builds Three.js Group with multi-link hierarchy for towers', () => {
    const solids = generateStructureSkeleton(DEMO_CHOPSTICK_TOWER_ARCHETYPE, 42);
    const group = buildStructureMeshGroup(solids, DEMO_CHOPSTICK_TOWER_ARCHETYPE);

    expect(group).toBeDefined();
    expect(group.children.length).toBeGreaterThan(0);

    // link-0 should be in rootGroup
    const link0 = group.getObjectByName('link-0');
    expect(link0).toBeDefined();

    // link-1 (elevator carriage) should exist
    const link1 = group.getObjectByName('link-1');
    expect(link1).toBeDefined();

    // link-2 and link-3 (chopsticks) should exist
    const link2 = group.getObjectByName('link-2');
    const link3 = group.getObjectByName('link-3');
    expect(link2).toBeDefined();
    expect(link3).toBeDefined();
  });

  it('reduces triangle counts progressively from LOD 0 to LOD 2', () => {
    const solids = generateStructureSkeleton(DEMO_RUNWAY_ARCHETYPE, 42);
    const lod0 = buildStructureMesh(solids, DEMO_RUNWAY_ARCHETYPE, { lod: 0 });
    const lod1 = buildStructureMesh(solids, DEMO_RUNWAY_ARCHETYPE, { lod: 1 });
    const lod2 = buildStructureMesh(solids, DEMO_RUNWAY_ARCHETYPE, { lod: 2 });

    expect(lod0.triangleCount).toBeGreaterThan(lod1.triangleCount);
    expect(lod1.triangleCount).toBeGreaterThan(lod2.triangleCount);
  });
});
