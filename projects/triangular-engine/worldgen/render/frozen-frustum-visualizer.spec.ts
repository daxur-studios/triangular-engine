import { CameraHelper, Group, LineSegments, Mesh, PerspectiveCamera, Vector3 } from 'three';
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

  it('keeps its camera and geometry frozen after the original camera moves or changes projection', () => {
    const camera = new PerspectiveCamera(60, 16 / 9, 0.5, 2_000_000);
    camera.position.set(0, 0, 600_100);
    camera.lookAt(0, 100_000, 600_100);
    const visualizer = createFrozenFrustumVisualizer(camera);
    const helper = visualizer.group.children[0] as CameraHelper;
    const matrix = helper.camera.matrixWorld.clone();
    const projection = helper.camera.projectionMatrix.clone();
    const volume = visualizer.group.children[2] as Mesh;
    const vertices = Array.from(volume.geometry.getAttribute('position').array);
    camera.position.set(500_000, 500_000, 1_000_000);
    camera.lookAt(0, 0, 0);
    camera.fov = 30;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    helper.update();
    expect(helper.camera).not.toBe(camera);
    expect(helper.camera.matrixWorld.equals(matrix)).toBeTrue();
    expect(helper.camera.projectionMatrix.equals(projection)).toBeTrue();
    expect(Array.from(volume.geometry.getAttribute('position').array)).toEqual(vertices);
    expect((helper.camera as PerspectiveCamera).near).toBe(0.5);
    expect((helper.camera as PerspectiveCamera).far).toBeLessThan(camera.far);
    visualizer.dispose();
  });

  it('captures world position and orientation when the camera belongs to a moving rig', () => {
    const rig = new Group();
    rig.position.set(100, 200, 600_000);
    rig.rotation.y = 0.3;
    const camera = new PerspectiveCamera();
    camera.position.set(10, 20, 100);
    rig.add(camera);
    rig.updateMatrixWorld(true);
    const worldPosition = camera.getWorldPosition(new Vector3());
    const worldDirection = camera.getWorldDirection(new Vector3());
    const visualizer = createFrozenFrustumVisualizer(camera);
    const helper = visualizer.group.children[0] as CameraHelper;
    const marker = visualizer.group.children[1] as Mesh;
    expect(marker.position.distanceTo(worldPosition)).toBeLessThan(1e-8);
    expect(helper.camera.getWorldPosition(new Vector3()).distanceTo(worldPosition)).toBeLessThan(1e-8);
    expect(helper.camera.getWorldDirection(new Vector3()).distanceTo(worldDirection)).toBeLessThan(1e-8);
    rig.position.x += 100_000;
    rig.updateMatrixWorld(true);
    expect(marker.position.distanceTo(worldPosition)).toBeLessThan(1e-8);
    visualizer.dispose();
  });

  it('disposes every geometry and material and detaches from the scene', () => {
    const camera = new PerspectiveCamera();
    camera.position.z = 600_100;
    const visualizer = createFrozenFrustumVisualizer(camera);
    const parent = new Group();
    parent.add(visualizer.group);
    const disposals = visualizer.group.children.flatMap((child) => {
      const object = child as Mesh | LineSegments;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) expect(material.depthWrite).toBeFalse();
      return [
        spyOn(object.geometry, 'dispose').and.callThrough(),
        ...materials.map((material) => spyOn(material, 'dispose').and.callThrough()),
      ];
    });
    visualizer.dispose();
    expect(parent.children.length).toBe(0);
    for (const dispose of disposals) expect(dispose).toHaveBeenCalledTimes(1);
  });
});
