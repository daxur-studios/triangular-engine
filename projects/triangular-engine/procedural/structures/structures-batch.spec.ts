import { Matrix4, Vector3 } from 'three';
import {
  COLONY_FUEL_TANK_ARCHETYPE,
  COLONY_SOLAR_PANEL_ARCHETYPE,
  createStructureInstancedMesh,
  StructureBatchManager,
  type IStructureInstanceTransform,
} from './public-api';

describe('StructureBatchManager and InstancedMesh', () => {
  it('creates an InstancedMesh with correct instance count and transforms', () => {
    const instances: IStructureInstanceTransform[] = [
      { position: [10, 0, 0] },
      { position: [20, 0, 0], scale: [1, 2, 1] },
      { position: [30, 0, 0], colorHex: '#ff0000' },
    ];

    const instancedMesh = createStructureInstancedMesh(
      COLONY_SOLAR_PANEL_ARCHETYPE,
      instances,
      { seed: 42 },
    );

    expect(instancedMesh.count).toBe(3);

    const mat = new Matrix4();
    instancedMesh.getMatrixAt(0, mat);
    const pos = new Vector3();
    pos.setFromMatrixPosition(mat);
    expect(pos.x).toBeCloseTo(10);

    instancedMesh.dispose();
  });

  it('StructureBatchManager groups instances into separate draw call batches', () => {
    const manager = new StructureBatchManager();

    manager.addInstances(COLONY_SOLAR_PANEL_ARCHETYPE, [
      { position: [0, 0, 0] },
      { position: [15, 0, 0] },
      { position: [30, 0, 0] },
    ]);

    manager.addInstances(COLONY_FUEL_TANK_ARCHETYPE, [
      { position: [0, 0, 50] },
      { position: [20, 0, 50] },
    ]);

    expect(manager.totalInstanceCount).toBe(5);
    expect(manager.drawCallCount).toBe(2);

    const group = manager.build();
    expect(group.children.length).toBe(2); // 2 InstancedMeshes (1 per archetype)

    manager.clear();
    expect(manager.totalInstanceCount).toBe(0);
    expect(group.children.length).toBe(0);
  });
});
