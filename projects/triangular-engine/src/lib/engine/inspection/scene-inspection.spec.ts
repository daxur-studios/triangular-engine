import {
  BoxGeometry,
  DirectionalLight,
  Group,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Scene,
} from 'three';
import { inspectScene } from './scene-inspection';

describe('inspectScene', () => {
  it('returns bounded scene counts, camera facts, and named objects', () => {
    const scene = new Scene();
    const camera = new PerspectiveCamera(45, 2, 0.1, 1000);
    camera.name = 'main-camera';
    camera.position.set(1.23456, 2, 3);

    const group = new Group();
    group.name = 'vehicle-stack';
    const mesh = new Mesh(new BoxGeometry(2, 4, 2), new MeshBasicMaterial());
    mesh.name = 'payload';
    mesh.position.y = 3.33333;
    group.add(mesh);
    scene.add(group, new DirectionalLight(), camera);

    const snapshot = inspectScene({ scene, camera }, { detail: 'standard' });

    expect(snapshot.version).toBe(1);
    expect(snapshot.scene.totalObjectCount).toBe(4);
    expect(snapshot.scene.visibleObjectCount).toBe(4);
    expect(snapshot.scene.meshCount).toBe(1);
    expect(snapshot.scene.lightCount).toBe(1);
    expect(snapshot.scene.cameraCount).toBe(1);
    expect(snapshot.camera.position).toEqual({ x: 1.235, y: 2, z: 3 });
    expect(snapshot.camera.fov).toBe(45);
    expect(snapshot.objects.map((object) => object.name)).toEqual([
      'main-camera',
      'vehicle-stack',
      'payload',
      '',
    ]);

    const payload = snapshot.objects.find((object) => object.name === 'payload');
    expect(payload?.path).toBe('vehicle-stack/payload');
    expect(payload?.worldPosition).toEqual({ x: 0, y: 3.333, z: 0 });
    expect(payload?.bounds).toBeDefined();
  });

  it('filters by visibility, name, and object id without changing aggregate counts', () => {
    const scene = new Scene();
    const camera = new PerspectiveCamera();
    const visible = new Group();
    visible.name = 'visible-object';
    const hidden = new Group();
    hidden.name = 'hidden-object';
    hidden.visible = false;
    scene.add(visible, hidden);

    const byName = inspectScene(
      { scene, camera },
      { nameIncludes: 'VISIBLE', visibleOnly: true },
    );
    expect(byName.scene.totalObjectCount).toBe(2);
    expect(byName.objects.map((object) => object.name)).toEqual(['visible-object']);

    const byId = inspectScene({ scene, camera }, { objectId: hidden.uuid });
    expect(byId.objects.map((object) => object.name)).toEqual(['hidden-object']);
  });

  it('reports truncation and duplicate-name warnings deterministically', () => {
    const scene = new Scene();
    const camera = new PerspectiveCamera();
    for (let index = 0; index < 3; index++) {
      const object = new Group();
      object.name = 'duplicate';
      scene.add(object);
    }

    const snapshot = inspectScene({ scene, camera }, { maxObjects: 2 });
    expect(snapshot.scene.truncated).toBe(true);
    expect(snapshot.scene.returnedObjectCount).toBe(2);
    expect(snapshot.warnings.map((warning) => warning.code)).toEqual([
      'duplicate-name',
      'truncated',
    ]);
  });

  it('reports invalid cameras and visible zero-scale objects', () => {
    const scene = new Scene();
    const camera = new PerspectiveCamera(45, 0, 0, -1);
    const object = new Group();
    object.name = 'collapsed';
    object.scale.set(0, 1, 1);
    scene.add(object);

    const snapshot = inspectScene({ scene, camera });
    expect(snapshot.warnings.map((warning) => warning.code)).toContain('invalid-camera');
    expect(snapshot.warnings.map((warning) => warning.code)).toContain('zero-scale');
  });
});
