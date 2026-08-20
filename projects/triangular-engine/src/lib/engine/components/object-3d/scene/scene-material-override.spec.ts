import {
  BoxGeometry,
  Group,
  Line,
  LineBasicMaterial,
  Material,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Points,
  PointsMaterial,
  Scene,
  Sprite,
  SpriteMaterial,
} from 'three';
import { SceneMaterialOverride } from './scene-material-override';

function createMesh(color = 0x888888): Mesh {
  return new Mesh(
    new BoxGeometry(),
    new MeshStandardMaterial({ color }),
  );
}

describe('SceneMaterialOverride', () => {
  let scene: Scene;
  let override: SceneMaterialOverride;

  beforeEach(() => {
    scene = new Scene();
    override = new SceneMaterialOverride(scene);
  });

  afterEach(() => {
    override.dispose();
  });

  it('replaces mesh materials with the shared override material when enabled', () => {
    const mesh = createMesh();
    scene.add(mesh);

    override.setEnabled(true);

    expect(mesh.material).toBe(override.material);
    expect(override.material).toBeInstanceOf(MeshBasicMaterial);
    expect((override.material as MeshBasicMaterial).wireframe).toBe(true);
  });

  it('restores the original material instances when disabled', () => {
    const mesh = createMesh(0x112233);
    const original = mesh.material;
    scene.add(mesh);

    override.setEnabled(true);
    override.setEnabled(false);

    expect(mesh.material).toBe(original);
  });

  it('restores separately-owned materials for each mesh touched', () => {
    const a = createMesh();
    const b = createMesh();
    const originalA = a.material;
    const originalB = b.material;
    scene.add(a, b);

    override.setEnabled(true);
    override.setEnabled(false);

    expect(a.material).toBe(originalA);
    expect(b.material).toBe(originalB);
  });

  it('leaves points and sprites untouched because they need their own material types', () => {
    const points = new Points(undefined, new PointsMaterial());
    const sprite = new Sprite(new SpriteMaterial());
    const pointsMaterial = points.material;
    const spriteMaterial = sprite.material;
    scene.add(points, sprite);

    override.setEnabled(true);

    expect(points.material).toBe(pointsMaterial);
    expect(sprite.material).toBe(spriteMaterial);
  });

  it('overrides lines and nested descending objects', () => {
    const line = new Line(
      new BoxGeometry(),
      [new LineBasicMaterial(), new LineBasicMaterial()],
    );
    const originalLineMaterials = line.material;
    const group = new Group();
    const mesh = createMesh();
    group.add(mesh);
    scene.add(line, group);

    override.setEnabled(true);

    expect(mesh.material).toBe(override.material);
    expect(line.material as unknown).toBe(override.material as unknown);

    override.setEnabled(false);
    expect(line.material).toBe(originalLineMaterials);
  });

  it('applies the override to meshes added while enabled', () => {
    override.setEnabled(true);

    const mesh = createMesh();
    scene.add(mesh);

    expect(mesh.material).toBe(override.material);
  });

  it('restores meshes added while enabled once disabled', () => {
    override.setEnabled(true);
    const mesh = createMesh();
    const original = mesh.material;
    scene.add(mesh);

    override.setEnabled(false);

    expect(mesh.material).toBe(original);
  });

  it('tracks nested descendants added while enabled through a group', () => {
    override.setEnabled(true);
    const group = new Group();
    const mesh = createMesh();
    group.add(mesh);
    scene.add(group);

    expect(mesh.material).toBe(override.material);

    override.setEnabled(false);
    expect(mesh.material).not.toBe(override.material);
  });

  it('is idempotent: re-enabling keeps the same original stored once', () => {
    const mesh = createMesh();
    scene.add(mesh);
    const original = mesh.material;

    override.setEnabled(true);
    override.setEnabled(true);

    override.setEnabled(false);
    expect(mesh.material).toBe(original);
  });

  it('setMaterial swaps the override everywhere while enabled', () => {
    const mesh = createMesh();
    scene.add(mesh);
    override.setEnabled(true);

    const next = new MeshBasicMaterial({ color: 0xff0000, wireframe: true });
    override.setMaterial(next);

    expect(mesh.material).toBe(next);
    next.dispose();
  });

  it('name-hash mode gives differently-named meshes distinct cached materials', () => {
    override.setMode('name-hash');
    override.setEnabled(true);

    const ground = createMesh();
    ground.name = 'ground';
    const vessel = createMesh();
    vessel.name = 'vessel';
    scene.add(ground, vessel);

    expect(ground.material).not.toBe(vessel.material);
    expect((ground.material as MeshBasicMaterial).wireframe).toBe(true);
  });

  it('name-hash mode reuses the same cached material for same-named meshes', () => {
    override.setMode('name-hash');
    override.setEnabled(true);

    const a = createMesh();
    a.name = 'rock';
    const b = createMesh();
    b.name = 'rock';
    scene.add(a, b);

    expect(a.material).toBe(b.material);
  });

  it('name-hash mode falls back to uuid for unnamed objects', () => {
    override.setMode('name-hash');
    override.setEnabled(true);

    const unnamed = createMesh();
    scene.add(unnamed);

    expect(unnamed.material).toBeInstanceOf(MeshBasicMaterial);
    expect((unnamed.material as MeshBasicMaterial).wireframe).toBe(true);
  });

  it('setMode re-colors while enabled', () => {
    const mesh = createMesh();
    mesh.name = 'hills';
    scene.add(mesh);
    override.setEnabled(true);
    const uniformMaterial = mesh.material;

    override.setMode('name-hash');

    expect(mesh.material).not.toBe(uniformMaterial);

    override.setEnabled(false);
    expect(mesh.material).not.toBe(uniformMaterial);
  });
});