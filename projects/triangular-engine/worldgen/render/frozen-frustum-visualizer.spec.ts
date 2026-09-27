import { Group, PerspectiveCamera } from 'three';
import { createFrozenFrustumVisualizer } from './frozen-frustum-visualizer';

describe('createFrozenFrustumVisualizer', () => {
  it('creates camera helper, eye marker, volume mesh, and edge lines', () => {
    const camera = new PerspectiveCamera(60, 16 / 9, 1, 2_000_000);
    camera.position.set(0, 0, 600_100);
    camera.lookAt(0, 100_000, 600_100);
    camera.updateMatrixWorld(true);

    const visualizer = createFrozenFrustumVisualizer(camera, {
      radiusM: 600_000,
      reliefMarginM: 4_000,
    });

    expect(visualizer.group).toBeInstanceOf(Group);
    expect(visualizer.group.name).toBe('frozen-frustum-visualizer');
    // Group contains: CameraHelper, marker Mesh, volume Mesh, edge LineSegments
    expect(visualizer.group.children.length).toBe(4);

    const parent = new Group();
    parent.add(visualizer.group);
    expect(parent.children.length).toBe(1);

    visualizer.dispose();
    expect(parent.children.length).toBe(0);
  });
});
